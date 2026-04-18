"use server";

/**
 * signInSocialAction
 *
 * Server Action that initiates a social sign-in flow. The browser calls this
 * when a user clicks a provider button on the sign-in or sign-up page.
 *
 * Flow:
 *   1. Validate the provider name against the enabled providers list.
 *   2. Rate-limit the request (per-IP, same bucket as email sign-in).
 *   3. Ask Better Auth to generate the provider's authorization URL.
 *   4. Emit audit event.
 *   5. Return { ok: true, url } so the caller can window.location.assign(url).
 *
 * This is a Server Action — no public HTTP route is created. The provider
 * redirect is handled by Better Auth after the user's browser navigates to
 * the returned URL. The OAuth2 callback lands on the dedicated per-provider
 * callback routes in app/api/auth/callback/{provider}/.
 *
 * Security:
 *   - CSRF protection: Next.js Server Actions enforce Origin + CSRF headers.
 *   - State parameter: Better Auth generates a cryptographically random state
 *     bound to the browser session — do not override or disable this.
 *   - PKCE (S256): Better Auth enables PKCE by default — do not disable.
 *   - redirectTo is validated against the dashboard's own origin via
 *     validateRedirectTo before being passed to Better Auth.
 *   - Client secrets are never exposed: Better Auth uses them internally;
 *     the returned url contains only the provider's authorize endpoint params.
 */

import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { buildSocialProviders, type ProviderId } from "@/src/lib/social-providers";
import { validateRedirectTo } from "@/src/lib/auth/redirect-allowlist";
import { checkRateLimit, getClientIP } from "@/src/lib/rate-limiter";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { getCorrelationId } from "@/src/lib/correlation";
import { recordDebugError } from "@/src/lib/debug";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignInSocialResult =
  | { ok: true; url: string }
  | {
      ok: false;
      code:
        | "INVALID_PROVIDER"
        | "PROVIDER_DISABLED"
        | "RATE_LIMITED"
        | "REDIRECT_NOT_ALLOWED"
        | "PROVIDER_ERROR";
      message: string;
    };

export interface SignInSocialInput {
  provider: string;
  redirectTo?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOCIAL_SIGNIN_RATE_LIMIT = {
  maxRequests: 20,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many sign-in attempts. Please try again in a minute.",
};

/** All known provider IDs — used for strict validation before consulting the
 *  enabled list so we never pass arbitrary strings to Better Auth. */
const ALL_PROVIDER_IDS = new Set<ProviderId>([
  "github",
  "gitlab",
  "google",
  "microsoft",
]);

// ---------------------------------------------------------------------------
// Server Action
// ---------------------------------------------------------------------------

export async function signInSocialAction(
  input: SignInSocialInput
): Promise<SignInSocialResult> {
  void getCorrelationId; // keeps the import live for the audit emitter

  // ── Validate provider ─────────────────────────────────────────────────────
  const providerRaw = (input.provider ?? "").trim().toLowerCase();

  if (!ALL_PROVIDER_IDS.has(providerRaw as ProviderId)) {
    return {
      ok: false,
      code: "INVALID_PROVIDER",
      message: `Unknown sign-in provider: "${providerRaw}".`,
    };
  }

  const provider = providerRaw as ProviderId;

  // ── Check provider is enabled ─────────────────────────────────────────────
  // buildSocialProviders() is called at module load in auth-server.ts; here
  // we call it again to get the enabled list for the current process.env state.
  // In practice this is effectively a cache read because the env does not
  // change after startup.
  const { enabled } = buildSocialProviders();
  if (!enabled.includes(provider)) {
    return {
      ok: false,
      code: "PROVIDER_DISABLED",
      message: `The "${provider}" sign-in provider is not enabled on this installation.`,
    };
  }

  // ── Validate redirectTo ───────────────────────────────────────────────────
  const safeRedirect = validateRedirectTo(input.redirectTo);
  // If the caller sent a redirectTo that was sanitised to "/", but they sent a
  // non-empty value, it means the URL was rejected as cross-origin.
  if (
    input.redirectTo &&
    input.redirectTo.trim().length > 0 &&
    safeRedirect === "/" &&
    input.redirectTo.trim() !== "/"
  ) {
    return {
      ok: false,
      code: "REDIRECT_NOT_ALLOWED",
      message: "The requested redirect destination is not allowed.",
    };
  }

  // ── Rate limit ────────────────────────────────────────────────────────────
  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const remoteIp = getClientIP(fakeReq);

  const rl = await checkRateLimit(
    fakeReq,
    "auth:signin-social",
    SOCIAL_SIGNIN_RATE_LIMIT
  );
  if (!rl.allowed) {
    emitAuthAudit({
      action: "signin_social_started",
      outcome: "rate_limited",
      userId: "anonymous",
      reason: "rate_limited",
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: SOCIAL_SIGNIN_RATE_LIMIT.message,
    };
  }

  // ── Emit start audit ─────────────────────────────────────────────────────
  emitAuthAudit({
    action: "signin_social_started",
    outcome: "ok",
    userId: "anonymous",
    reason: provider,
    ip: remoteIp,
  });

  // ── Ask Better Auth for the authorization URL ─────────────────────────────
  try {
    const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
    const callbackURL = `${baseUrl}/api/auth/callback/${provider}`;

    const result = await auth.api.signInSocial({
      body: {
        provider,
        callbackURL,
        // Pass the safe redirect as a newUserCallbackURL so Better Auth
        // surfaces it after completing the flow for new users. Returning
        // users land on their active org's dashboard via the session.
        newUserCallbackURL: safeRedirect !== "/" ? safeRedirect : undefined,
        // disableRedirect=true returns the URL without issuing a 302 so
        // this Server Action can hand it back to the client for
        // window.location.assign().
        disableRedirect: true,
      },
      headers: reqHeaders,
    });

    // Better Auth returns { url } when disableRedirect=true.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const url = (result as any)?.url as string | undefined;
    if (!url) {
      emitAuthAudit({
        action: "signin_social_failed",
        outcome: "failed",
        userId: "anonymous",
        reason: "no_url_returned",
        ip: remoteIp,
      });
      return {
        ok: false,
        code: "PROVIDER_ERROR",
        message: "Unable to start sign-in. Please try again.",
      };
    }

    return { ok: true, url };
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:signInSocial",
      method: "ACTION",
      status: 500,
      message: e.message,
    });
    emitAuthAudit({
      action: "signin_social_failed",
      outcome: "failed",
      userId: "anonymous",
      reason: provider,
      errorMessage: e.message,
      ip: remoteIp,
    });
    return {
      ok: false,
      code: "PROVIDER_ERROR",
      message: "Unable to start sign-in. Please try again.",
    };
  }
}
