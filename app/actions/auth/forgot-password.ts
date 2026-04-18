"use server";

/**
 * forgotPasswordAction
 *
 * Server Action that initiates the password-reset flow. Calls Better Auth's
 * `requestPasswordReset` endpoint which dispatches the reset email via the
 * `sendResetPassword` hook wired in `src/lib/auth-server.ts`.
 *
 * Enumeration resistance:
 *   - Always returns the identical `{ ok: true, message }` payload regardless
 *     of whether the email matches any account — including when CAPTCHA
 *     verification fails. An attacker probing this endpoint cannot
 *     distinguish "bad captcha" from "email unknown" from "reset sent".
 *   - Better Auth already pads non-existent-email paths with a dummy
 *     verification token lookup to mitigate timing attacks server-side.
 *   - Rate limits: 5/hr per IP + 3/hr per email address (account-keyed via a
 *     fixed-length hash so the raw address never appears in Redis keys).
 *   - Audit is emitted on every terminal path (match, no-match, captcha fail).
 *
 * Task 31 — CAPTCHA enforcement:
 *   Optional `captchaToken` input. When the CAPTCHA provider is enabled
 *   (DASHBOARD_CAPTCHA_PROVIDER=turnstile|hcaptcha) a missing or invalid
 *   token fails the challenge — but we still return the generic success
 *   response to preserve enumeration resistance. The captchaFailures
 *   metric is incremented and a `captcha_failed` audit is emitted.
 *   In disabled mode verifyCaptcha returns ok:true even for an empty
 *   token, so existing callers that don't pass a token continue to work.
 */

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";

import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { captchaFailures, passwordResets } from "@/src/lib/metrics/auth";
import { checkRateLimit, checkRateLimitByKey, getClientIP } from "@/src/lib/rate-limiter";
import { recordDebugError } from "@/src/lib/debug";
import { verifyCaptcha } from "@/src/lib/auth/captcha";

/**
 * True when the resolved user row has no credential account — i.e. a shell
 * user created by admin-provisioning that hasn't claimed their account yet.
 * For these users the forgot-password flow is a no-op; we return the generic
 * success message so attackers cannot distinguish shell users from normal
 * accounts (same enumeration-resistance posture as "email doesn't exist").
 */
async function isShellUser(email: string): Promise<boolean> {
  try {
    const ctx = (await auth.$context) as unknown as {
      internalAdapter: {
        findUserByEmail: (e: string) => Promise<unknown>;
        findAccounts: (
          userId: string,
        ) => Promise<Array<{ providerId: string; password?: string | null }>>;
      };
    };
    const rec = await ctx.internalAdapter.findUserByEmail(email);
    const user =
      (rec as { user?: { id: string } } | null)?.user ??
      (rec as { id?: string } | null);
    if (!user || !("id" in user) || !user.id) return false;
    const accounts = await ctx.internalAdapter.findAccounts(String(user.id));
    // A real credential account has a non-empty password hash. If there is no
    // credential account at all, or it has a null password, treat as shell.
    const cred = accounts.find((a) => a.providerId === "credential");
    return !cred || !cred.password;
  } catch {
    // Any lookup error — fall through to the normal path (defence-in-depth:
    // better to send an unnecessary email than to silently drop a legitimate
    // reset request).
    return false;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENERIC_SUCCESS_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

const IP_RATE_LIMIT = {
  maxRequests: 5,
  windowSeconds: 3600,
  algorithm: "fixed_window" as const,
  message: GENERIC_SUCCESS_MESSAGE,
};

const ACCOUNT_RATE_LIMIT = {
  maxRequests: 3,
  windowSeconds: 3600,
  algorithm: "fixed_window" as const,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ForgotPasswordResult = {
  ok: true;
  message: string;
};

export type ForgotPasswordInput =
  | string
  | {
      email: string;
      /** CAPTCHA response token produced by the client widget (optional). */
      captchaToken?: string;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce a fixed-length key for the account-keyed rate limiter.
 * Uses SHA-256 of the normalized email so the raw address never appears
 * in Redis keys while still providing per-account isolation.
 */
function emailRateLimitKey(email: string): string {
  const normalized = email.trim().toLowerCase();
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `ratelimit:forgot-password:account:${hash}`;
}

function resolveCaptchaProviderLabel(): "turnstile" | "hcaptcha" | "disabled" {
  const raw = (process.env.DASHBOARD_CAPTCHA_PROVIDER ?? "").toLowerCase();
  if (raw === "turnstile") return "turnstile";
  if (raw === "hcaptcha") return "hcaptcha";
  return "disabled";
}

function parseInput(input: ForgotPasswordInput): {
  email: string;
  captchaToken?: string;
} {
  if (typeof input === "string") return { email: input };
  return { email: input.email, captchaToken: input.captchaToken };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function forgotPasswordAction(
  input: ForgotPasswordInput,
): Promise<ForgotPasswordResult> {
  const { email, captchaToken } = parseInput(input);

  const reqHeaders = await headers();
  const fakeReq = { headers: reqHeaders } as unknown as NextRequest;
  const remoteIp = getClientIP(fakeReq);

  // 0. CAPTCHA verification (Task 31). Runs BEFORE rate limiters so bots
  //    cannot exhaust the IP/account budgets of real users. On failure we
  //    still return the generic success message (enumeration resistance).
  const tokenStr = typeof captchaToken === "string" ? captchaToken : "";
  const captchaResult = await verifyCaptcha(tokenStr, remoteIp);
  if (!captchaResult.ok) {
    captchaFailures.inc({ provider: resolveCaptchaProviderLabel() });
    emitAuthAudit({
      action: "captcha_failed",
      outcome: "failed",
      userId: "anonymous",
      reason: "forgot_password",
      ip: remoteIp,
    });
    return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
  }

  // 1. Per-IP rate limit.
  const ipRl = await checkRateLimit(fakeReq, "auth:forgot-password:ip", IP_RATE_LIMIT);
  if (!ipRl.allowed) {
    // Still emit the audit so ops can spot abuse even on rate-limited paths.
    emitAuthAudit({
      action: "password_reset_requested",
      outcome: "rate_limited",
      userId: "anonymous",
    });
    passwordResets.inc({ outcome: "rate_limited" });
    // Return generic success — never expose the rate-limit to the caller.
    return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
  }

  // 2. Per-account (email-keyed) rate limit.
  const emailKey = emailRateLimitKey(typeof email === "string" ? email : "");
  const accountRl = await checkRateLimitByKey(emailKey, ACCOUNT_RATE_LIMIT);
  if (!accountRl.allowed) {
    emitAuthAudit({
      action: "password_reset_requested",
      outcome: "rate_limited",
      userId: "anonymous",
    });
    passwordResets.inc({ outcome: "rate_limited" });
    return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
  }

  // 3. Shell-user short-circuit. A shell user (admin-provisioned account with
  //    no password hash) cannot complete a password-reset flow — Better Auth
  //    would send a reset email to an account the user has never signed in
  //    to, and the resulting reset would silently create credentials out of
  //    an inbox-only invite. That collapses the distinction between the
  //    claim flow (SPIFFE-gated admin action) and self-serve password
  //    recovery. Treat these requests as if the email doesn't exist:
  //    identical generic response, no email dispatched, informational audit.
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (trimmedEmail && (await isShellUser(trimmedEmail))) {
    emitAuthAudit({
      action: "password_reset_requested",
      outcome: "ok",
      userId: "anonymous",
      reason: "shell_user_ignored",
    });
    passwordResets.inc({ outcome: "ok" });
    return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
  }

  // 4. Call Better Auth. Whether or not the email exists, Better Auth returns
  //    a successful response (it pads internally for timing resistance).
  try {
    await auth.api.requestPasswordReset({
      body: {
        email: trimmedEmail,
        redirectTo: "/reset-password",
      },
      headers: reqHeaders,
    });

    emitAuthAudit({
      action: "password_reset_requested",
      outcome: "ok",
      userId: "anonymous",
    });
    passwordResets.inc({ outcome: "ok" });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    recordDebugError({
      ts: new Date().toISOString(),
      route: "action:forgotPassword",
      method: "ACTION",
      status: 500,
      message: e.message,
      stack: e.stack,
    });
    emitAuthAudit({
      action: "password_reset_requested",
      outcome: "failed",
      userId: "anonymous",
      errorMessage: e.message,
    });
    passwordResets.inc({ outcome: "failed" });
    // Swallow all errors — we always return the same generic message.
  }

  return { ok: true, message: GENERIC_SUCCESS_MESSAGE };
}
