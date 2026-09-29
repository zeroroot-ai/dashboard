// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * Server Actions for the /dashboard/domain-packs page (ADR-0033, gibson#383).
 *
 * Each action wraps the typed gibson-client functions in
 * src/lib/gibson-client/domain-packs.ts, which dispatch through the
 * user-acting transport (userClient). That transport bakes the
 * registry-driven `assertAuthorized` check into every RPC (dashboard#848 /
 * #902); a denial is thrown as AuthzDeniedError and mapped to the canonical
 * "Permission denied" result by permissionDeniedResult (dashboard#904). The
 * daemon + ext-authz still enforce; this is defense-in-depth.
 *
 * EnableDomainPack and DisableDomainPack require the tenant "admin" relation
 * (ADR-0067, mirroring ConnectorService); the list RPCs require "member".
 *
 * A daemon-unavailable failure (the RPC never reaches the daemon, or the
 * daemon itself errors) is never swallowed into an empty list: it surfaces
 * through serverActionError's typed `code` (e.g. "unavailable"), and the
 * panel renders that as a distinct error state rather than an empty catalog.
 */

import "server-only";

import { z } from "zod";

import {
  daemonListDomainPackCatalog,
  daemonListDomainPacks,
  daemonEnableDomainPack,
  daemonDisableDomainPack,
} from "@/src/lib/gibson-client/domain-packs";
import type {
  DomainPackCatalogEntryDTO,
  DomainPackViewDTO,
} from "@/src/lib/gibson-client/domain-pack-types";
import { getServerSession } from "@/src/lib/auth";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";

// ---------------------------------------------------------------------------
// Shared result type (mirrors the existing ActionResult<T> convention)
// ---------------------------------------------------------------------------

type DomainPackActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** A Domain Pack catalog name, e.g. "main". */
const domainPackNameSchema = z
  .string()
  .min(1, "A Domain Pack name is required")
  .max(256, "The Domain Pack name must be at most 256 characters");

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * List the curated catalog plus the tenant's currently enabled Domain
 * Packs. Both RPCs require the tenant "member" relation.
 */
export async function listDomainPacksAction(): Promise<
  DomainPackActionResult<{ catalog: DomainPackCatalogEntryDTO[]; enabled: DomainPackViewDTO[] }>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  try {
    const [catalog, enabled] = await Promise.all([
      daemonListDomainPackCatalog(),
      daemonListDomainPacks(),
    ]);
    return { ok: true, data: { catalog, enabled } };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "listDomainPacksAction" });
  }
}

/**
 * Enable a catalog Domain Pack. Requires the tenant "admin" relation; the
 * transport's baked-in assertAuthorized denies members before dispatch.
 */
export async function enableDomainPackAction(
  name: string,
): Promise<DomainPackActionResult<{ name: string; version: number }>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = domainPackNameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    const data = await daemonEnableDomainPack(parsed.data);
    return { ok: true, data };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "enableDomainPackAction" });
  }
}

/**
 * Disable a Domain Pack. Requires the tenant "admin" relation; the
 * transport's baked-in assertAuthorized denies members before dispatch.
 */
export async function disableDomainPackAction(
  name: string,
): Promise<DomainPackActionResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }
  const parsed = domainPackNameSchema.safeParse(name);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }
  try {
    await daemonDisableDomainPack(parsed.data);
    return { ok: true, data: null };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "disableDomainPackAction" });
  }
}
