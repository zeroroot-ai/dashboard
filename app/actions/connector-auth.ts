"use server";

/**
 * Server Actions for the connector authorization flow (ADR-0064,
 * dashboard#1093).
 *
 * beginConnectorAuthorizationAction does everything up to the human step:
 * discovers the vendor's OAuth server, registers (or accepts) a public
 * client, seals the PKCE material into a signed httpOnly cookie, and hands
 * the client the authorize URL to navigate to. The human step is a top-level
 * browser navigation; the vendor redirects back into
 * /dashboard/connectors/oauth/callback (a Route Handler), which finishes the
 * exchange server-side and delivers the grant to the daemon.
 *
 * The status and revoke actions are thin wrappers over
 * gibson.tenant.v1.ConnectorAuthService.
 */

import "server-only";

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { assertAuthorized, permissionDeniedResult } from "@/src/lib/auth/assert-authorized";
import { serverActionError } from "@/src/lib/errors/server-action-error";
import {
  getConnectorAuthStatus,
  revokeConnectorGrant,
} from "@/src/lib/gibson-client/connector-auth";
import {
  discoverAuthServer,
  registerClient,
  VendorError,
} from "@/src/lib/connector-oauth/vendor";
import {
  CONNECTOR_OAUTH_COOKIE,
  CONNECTOR_OAUTH_CALLBACK_PATH,
  connectorOAuthCookieOptions,
  sealConnectorOAuthSession,
  newCodeVerifier,
  newState,
  codeChallengeS256,
} from "@/src/lib/connector-oauth/state-cookie";
import { listMembersAction } from "@/app/actions/read/listMembers";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; correlationId?: string };

// ---------------------------------------------------------------------------
// Begin authorization
// ---------------------------------------------------------------------------

const beginSchema = z.object({
  /** The plugin install id, for the post-callback redirect. */
  installId: z.string().min(1).max(256),
  /** The connector component name the grant will belong to. */
  connector: z.string().min(1).max(256),
  /** The vendor instance root, e.g. https://gitlab.com. */
  instanceUrl: z.string().min(1).max(2048),
  /** OAuth scope to request. The GitLab MCP server's scope is "mcp". */
  scope: z.string().min(1).max(256),
  /**
   * Optional application ID of a hand-created OAuth application on the
   * vendor. Supplied when the instance has dynamic client registration
   * disabled; otherwise the flow registers its own public client.
   */
  clientId: z.string().max(512).optional(),
});

export async function beginConnectorAuthorizationAction(
  input: z.infer<typeof beginSchema>,
): Promise<ActionResult<{ authorizeUrl: string }>> {
  // The begin step talks only to the vendor, so gate it on the same
  // permission the completion RPC enforces — an operator who could not
  // finish must not be able to start.
  try {
    await assertAuthorized(
      "/gibson.tenant.v1.ConnectorAuthService/CompleteConnectorAuthorization",
    );
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "beginConnectorAuthorizationAction" });
  }

  const parsed = beginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid authorization request." };
  }
  const { installId, connector, instanceUrl, scope } = parsed.data;

  const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (!baseUrl) {
    return { ok: false, error: "The dashboard's external URL is not configured." };
  }
  const redirectUri = new URL(CONNECTOR_OAUTH_CALLBACK_PATH, baseUrl).toString();

  try {
    const server = await discoverAuthServer(instanceUrl);
    if (!server.supportsS256) {
      return {
        ok: false,
        error: "The instance's OAuth server does not support PKCE (S256).",
      };
    }

    let clientId = parsed.data.clientId?.trim() || "";
    if (!clientId) {
      if (!server.registrationEndpoint) {
        return {
          ok: false,
          error:
            "The instance does not offer dynamic client registration. " +
            "Create an OAuth application on the instance and supply its application ID.",
        };
      }
      clientId = await registerClient(
        server.registrationEndpoint,
        redirectUri,
        `zeroroot connector ${connector}`,
        scope,
      );
    }

    const state = newState();
    const codeVerifier = newCodeVerifier();

    const cookieStore = await cookies();
    cookieStore.set(
      CONNECTOR_OAUTH_COOKIE,
      sealConnectorOAuthSession({
        state,
        codeVerifier,
        installId,
        connector,
        tokenEndpoint: server.tokenEndpoint,
        revocationEndpoint: server.revocationEndpoint,
        clientId,
        scope,
        redirectUri,
      }),
      connectorOAuthCookieOptions(),
    );

    const authorizeUrl = new URL(server.authorizationEndpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("scope", scope);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallengeS256(codeVerifier));
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    return { ok: true, data: { authorizeUrl: authorizeUrl.toString() } };
  } catch (err) {
    if (err instanceof VendorError) {
      // Written for the operator, carries no credential material.
      return { ok: false, error: err.message };
    }
    return serverActionError(err, { action: "beginConnectorAuthorizationAction" });
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ConnectorAuthStatusView {
  /** "unauthorized" | "authorized" | "refresh_failing" */
  state: string;
  /** FGA user ref of the authorizing human, e.g. "user:3129…". */
  authorizedBy: string;
  /** Display name/email of the authorizing human, when resolvable. */
  authorizedByDisplay: string;
  /** ISO 8601, or empty. */
  authorizedAt: string;
  scope: string;
  /** ISO 8601, or empty when no access token is published. */
  accessTokenExpiresAt: string;
  lastRefreshError: string;
  /** ISO 8601, or empty. */
  lastRefreshAt: string;
}

function tsToIso(ts?: { seconds: bigint; nanos: number }): string {
  if (!ts) return "";
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  return new Date(ms).toISOString();
}

const statusSchema = z.object({ connector: z.string().min(1).max(256) });

export async function getConnectorAuthStatusAction(
  input: z.infer<typeof statusSchema>,
): Promise<ActionResult<ConnectorAuthStatusView>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid status request." };
  }
  try {
    // Defense in depth alongside the transport interceptor's own check.
    await assertAuthorized("/gibson.tenant.v1.ConnectorAuthService/GetConnectorAuthStatus");
    const resp = await getConnectorAuthStatus(parsed.data.connector);
    const stateNames: Record<number, string> = {
      1: "unauthorized",
      2: "authorized",
      3: "refresh_failing",
    };

    // Best-effort resolution of the numeric subject to a person the
    // operator recognises. The authoritative record stays the FGA ref on
    // the grant; this is display sugar and an empty result is fine.
    let authorizedByDisplay = "";
    const subject = resp.authorizedBy.startsWith("user:")
      ? resp.authorizedBy.slice("user:".length)
      : "";
    if (subject) {
      const members = await listMembersAction();
      if (members.ok) {
        const hit = members.data.find((m) => m.userId === subject);
        if (hit) authorizedByDisplay = hit.displayName || hit.email;
      }
    }

    return {
      ok: true,
      data: {
        state: stateNames[resp.state] ?? "unauthorized",
        authorizedBy: resp.authorizedBy,
        authorizedByDisplay,
        authorizedAt: tsToIso(resp.authorizedAt),
        scope: resp.scope,
        accessTokenExpiresAt: tsToIso(resp.accessTokenExpiresAt),
        lastRefreshError: resp.lastRefreshError,
        lastRefreshAt: tsToIso(resp.lastRefreshAt),
      },
    };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "getConnectorAuthStatusAction" });
  }
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

const revokeSchema = z.object({
  connector: z.string().min(1).max(256),
  installId: z.string().min(1).max(256),
});

export async function revokeConnectorGrantAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult<{ hadGrant: boolean; vendorRevoked: boolean }>> {
  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Invalid revoke request." };
  }
  try {
    // Defense in depth alongside the transport interceptor's own check.
    await assertAuthorized("/gibson.tenant.v1.ConnectorAuthService/RevokeConnectorGrant");
    const resp = await revokeConnectorGrant(parsed.data.connector);
    revalidatePath(`/dashboard/pages/settings/plugins/${parsed.data.installId}`);
    return {
      ok: true,
      data: { hadGrant: resp.hadGrant, vendorRevoked: resp.vendorRevoked },
    };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return serverActionError(err, { action: "revokeConnectorGrantAction" });
  }
}
