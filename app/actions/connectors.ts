"use server";

/**
 * Server Actions for the /dashboard/connectors page (ADR-0067, UI slice 1).
 *
 * Replaces the deleted delegation routes at app/api/settings/connectors/*.
 * Each action wraps the typed gibson-client functions in
 * src/lib/gibson-client/connectors.ts, which dispatch through the user-acting
 * transport (userClient). That transport bakes the registry-driven
 * `assertAuthorized` check into every RPC (dashboard#848 / #902); a denial is
 * thrown as AuthzDeniedError and mapped to the canonical "Permission denied"
 * result by permissionDeniedResult (dashboard#904). The daemon + ext-authz
 * still enforce; this is defense-in-depth.
 *
 * EnableConnector and DisableConnector require the tenant "admin" relation
 * (gibson#1553); the list RPCs require "member".
 */

import "server-only";

import { z } from "zod";

import {
  daemonListCatalog,
  daemonListConnectors,
  daemonEnableConnector,
  daemonDisableConnector,
  daemonGetConnectorAuthStatus,
  daemonStartConnectorAuthorization,
  daemonRevokeConnectorGrant,
} from "@/src/lib/gibson-client/connectors";
import type {
  CatalogEntryDTO,
  ConnectorDTO,
  ConnectorAuthDTO,
} from "@/src/lib/gibson-client/connector-types";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

// ---------------------------------------------------------------------------
// Shared result type (mirrors the existing ActionResult<T> convention)
// ---------------------------------------------------------------------------

type ConnectorActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** A connector or catalog id, e.g. "gitlab". */
const connectorIdSchema = z
  .string()
  .min(1, "A connector id is required")
  .max(256, "The connector id must be at most 256 characters");

/**
 * The instance base URL for an OAuth authorization. May be empty; the daemon
 * falls back to the catalog default and validates the URL itself.
 */
const instanceUrlSchema = z
  .string()
  .max(2048, "The instance URL must be at most 2048 characters");

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * List the curated catalog plus the tenant's enabled connectors with live
 * status. ConnectorService list RPCs require the tenant "member" relation.
 */
export async function listConnectorsAction(): Promise<
  ConnectorActionResult<{ catalog: CatalogEntryDTO[]; enabled: ConnectorDTO[] }>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    const [catalog, enabled] = await Promise.all([
      daemonListCatalog(),
      daemonListConnectors(),
    ]);
    return { ok: true, data: { catalog, enabled } };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listConnectorsAction" });
  }
}

/**
 * Enable a catalog connector. Requires the tenant "admin" relation; the
 * transport's baked-in assertAuthorized denies members before dispatch.
 */
export async function enableConnectorAction(
  catalogId: string,
): Promise<ConnectorActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = connectorIdSchema.safeParse(catalogId);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    await daemonEnableConnector(parsed.data);
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "enableConnectorAction" });
  }
}

/**
 * Disable a connector. Requires the tenant "admin" relation; the transport's
 * baked-in assertAuthorized denies members before dispatch.
 */
export async function disableConnectorAction(
  connector: string,
): Promise<ConnectorActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = connectorIdSchema.safeParse(connector);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    await daemonDisableConnector(parsed.data);
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "disableConnectorAction" });
  }
}

/** Read the OAuth grant status for one connector ("member" relation). */
export async function getConnectorAuthStatusAction(
  connector: string,
): Promise<ConnectorActionResult<ConnectorAuthDTO>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = connectorIdSchema.safeParse(connector);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    const auth = await daemonGetConnectorAuthStatus(parsed.data);
    return { ok: true, data: auth };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "getConnectorAuthStatusAction" });
  }
}

/**
 * Start the OAuth authorization for a connector and return the vendor
 * authorize URL the human opens to consent once. The daemon holds the PKCE
 * verifier and completes the grant at its callback.
 */
export async function startConnectorAuthorizationAction(
  connector: string,
  instanceUrl: string,
): Promise<ConnectorActionResult<{ authorizeUrl: string }>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsedId = connectorIdSchema.safeParse(connector);
  if (!parsedId.success) {
    return {
      ok: false,
      error: parsedId.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  const parsedUrl = instanceUrlSchema.safeParse(instanceUrl);
  if (!parsedUrl.success) {
    return {
      ok: false,
      error: parsedUrl.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    const authorizeUrl = await daemonStartConnectorAuthorization(
      parsedId.data,
      parsedUrl.data,
    );
    return { ok: true, data: { authorizeUrl } };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "startConnectorAuthorizationAction" });
  }
}

/** Revoke a connector's OAuth grant. */
export async function revokeConnectorGrantAction(
  connector: string,
): Promise<ConnectorActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = connectorIdSchema.safeParse(connector);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    await daemonRevokeConnectorGrant(parsed.data);
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "revokeConnectorGrantAction" });
  }
}
