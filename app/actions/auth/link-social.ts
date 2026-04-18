"use server";

/**
 * linkSocialAction
 *
 * Server Action that links a new social provider to the currently signed-in
 * user's account. Requires an active session — this spec ships
 * link-while-signed-in only; there is NO merge flow for signed-out users.
 *
 * Flow:
 *   1. Require an active session (unauthenticated → UNAUTHENTICATED).
 *   2. Validate the provider name.
 *   3. Rate-limit.
 *   4. Ask Better Auth to generate the link authorization URL.
 *   5. Emit audit event.
 *   6. Return { ok: true, url } for the caller to window.location.assign().
 *
 * Security:
 *   - MUST require an active session. linkSocialAction never falls through
 *     to a merge flow for an unauthenticated caller.
 *   - The linking is scoped to the session user — Better Auth enforces this
 *     via its freshSessionMiddleware on /link-social.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { getSession } from "@/app/actions/auth/session";
import { type ProviderId } from "@/src/lib/social-providers";
import { checkRateLimit, getClientIP } from "@/src/lib/rate-limiter";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { recordDebugError } from "@/src/lib/debug";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkSocialResult =
  | { ok: true; url: string }
  | {
      ok: false;
      code:
        | "UNAUTHENTICATED"
        | "INVALID_PROVIDER"
        | "PROVIDER_DISABLED"
        | "RATE_LIMITED"
        | "PROVIDER_ERROR";
      message: string;
    };

export interface LinkSocialInput {
  provider: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LINK_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many link attempts. Please try again in a minute.",
};

const ALL_PROVIDER_IDS = new Set<ProviderId>([
  "github",
  "gitlab",
  "google",
  "microsoft",
]);

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function linkSocialAction(
  input: LinkSocialInput
): Promise<LinkSocialResult> {
  // ── Require session ───────────────────────────────────────────────────────
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "You must be signed in to link a provider.",
    };
  }

  const userId = session.user.id;

  // ── Validate provider ─────────────────────────────────────────────────────
  const providerRaw = (input.provider ?? "").trim().toLowerCase();
  if (!ALL_PROVIDER_IDS.has(providerRaw as ProviderId)) {
    return {
      ok: false,
      code: "INVALID_PROVIDER",
      message: `Unknown provider: "${providerRaw}".`,
    };
  }
  const provider = providerRaw as ProviderId;

  // ── Rate limit ────────────────────────────────────────────────────────────
  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const remoteIp = getClientIP(fakeReq);

  const rl = await checkRateLimit(fakeReq, "auth:link-social", LINK_RATE_LIMIT);
  if (!rl.allowed) {
    emitAuthAudit({
      action: "link_social",
      outcome: "rate_limited",
      userId,
      reason: "rate_limited",
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: LINK_RATE_LIMIT.message,
    };
  }

  // ── Ask Better Auth for the link authorization URL ────────────────────────
  try {
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    const callbackURL = `${baseUrl}/api/auth/callback/${provider}`;

    const result = await auth.api.linkSocialAccount({
      body: {
        provider,
        callbackURL,
      },
      headers: reqHeaders,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (result as any)?.url as string | undefined;
    if (!url) {
      emitAuthAudit({
        action: "link_social",
        outcome: "failed",
        userId,
        reason: "no_url_returned",
        ip: remoteIp,
      });
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: "Unable to start provider linking. Please try again.",
      };
    }

    emitAuthAudit({
      action: "link_social",
      outcome: "ok",
      userId,
      reason: provider,
      ip: remoteIp,
    });

    return { ok: true, url };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:linkSocial",
      method: "ACTION",
      status: 500,
      message: e.message,
    });
    emitAuthAudit({
      action: "link_social",
      outcome: "failed",
      userId,
      reason: provider,
      errorMessage: e.message,
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "Unable to link provider. Please try again.",
    };
  }
}
