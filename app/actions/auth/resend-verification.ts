"use server";

/**
 * resendVerificationAction
 *
 * Server Action for resending the email-verification link. Rate-limited
 * at two granularities:
 *   - 1 per 60 seconds per user (short burst protection)
 *   - 5 per hour per user (sustained abuse protection)
 *
 * Both limits are keyed by userId so they survive IP rotation.
 *
 * Requires an active session. Returns UNAUTHENTICATED without one.
 *
 * Task 31 — CAPTCHA enforcement:
 *   Requires a captcha token when the provider is enabled. In disabled
 *   mode `verifyCaptcha` short-circuits to `ok:true` regardless of the
 *   token so local development flows without a site key keep working.
 *   A missing or invalid token under an enabled provider returns
 *   `CAPTCHA_FAILED`, increments `captchaFailures`, and emits a
 *   `captcha_failed` audit event.
 *
 * On success:
 *   - Delegates to Better Auth's sendVerificationEmail endpoint.
 *   - Emits `email_verification_requested` audit event.
 *   - Increments emailVerifications counter with outcome='ok'.
 *   - Returns { ok: true }.
 *
 * On rate-limit:
 *   - Returns { ok: false, code: 'RATE_LIMITED', retryAfterSeconds }.
 *
 * On missing session:
 *   - Returns { ok: false, code: 'UNAUTHENTICATED' }.
 */

import { headers } from "next/headers";
import { getServerSession } from "@/src/lib/auth";
import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { captchaFailures, emailVerifications } from "@/src/lib/metrics/auth";
import { checkRateLimitByKey } from "@/src/lib/rate-limiter";
import { verifyCaptcha } from "@/src/lib/auth/captcha";

const RL_PER_MINUTE = {
  maxRequests: 1,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
};

const RL_PER_HOUR = {
  maxRequests: 5,
  windowSeconds: 3600,
  algorithm: "fixed_window" as const,
};

const VERIFY_CALLBACK_URL = "/verify-email/confirm";

export type ResendVerificationResult =
  | { ok: true }
  | { ok: false; code: "UNAUTHENTICATED" }
  | { ok: false; code: "CAPTCHA_FAILED"; message: string }
  | { ok: false; code: "RATE_LIMITED"; retryAfterSeconds: number }
  | { ok: false; code: "SERVICE_ERROR"; message: string };

export interface ResendVerificationInput {
  /** CAPTCHA response token produced by the client widget (optional). */
  captchaToken?: string;
}

function resolveCaptchaProviderLabel(): "turnstile" | "hcaptcha" | "disabled" {
  const raw = (process.env.DASHBOARD_CAPTCHA_PROVIDER ?? "").toLowerCase();
  if (raw === "turnstile") return "turnstile";
  if (raw === "hcaptcha") return "hcaptcha";
  return "disabled";
}

export async function resendVerificationAction(
  input?: ResendVerificationInput,
): Promise<ResendVerificationResult> {
  const session = await getServerSession();
  if (!session?.user?.id || !session.user.email) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  const userId = session.user.id;
  const email = session.user.email;

  // CAPTCHA gate (Task 31). Run BEFORE rate limits so bots cannot exhaust
  // the per-user budget of real users. In disabled mode this is a no-op:
  // verifyCaptcha returns { ok: true } for an empty token.
  const tokenStr =
    typeof input?.captchaToken === "string" ? input.captchaToken : "";
  const captchaResult = await verifyCaptcha(tokenStr);
  if (!captchaResult.ok) {
    captchaFailures.inc({ provider: resolveCaptchaProviderLabel() });
    emitAuthAudit({
      action: "captcha_failed",
      outcome: "failed",
      userId,
      reason: "resend_verification",
    });
    return {
      ok: false,
      code: "CAPTCHA_FAILED",
      message: "Verification challenge failed. Please try again.",
    };
  }

  // Per-minute guard: at most 1 resend per 60s.
  const rlMinute = await checkRateLimitByKey(
    `ratelimit:resend-verification:minute:${userId}`,
    RL_PER_MINUTE,
  );
  if (!rlMinute.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: rlMinute.resetIn,
    };
  }

  // Per-hour guard: at most 5 resends per hour.
  const rlHour = await checkRateLimitByKey(
    `ratelimit:resend-verification:hour:${userId}`,
    RL_PER_HOUR,
  );
  if (!rlHour.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: rlHour.resetIn,
    };
  }

  try {
    const requestHeaders = await headers();
    await auth.api.sendVerificationEmail({
      body: {
        email,
        callbackURL: VERIFY_CALLBACK_URL,
      },
      headers: requestHeaders,
    });

    emitAuthAudit({
      action: "email_verification_requested",
      outcome: "ok",
      userId,
    });
    emailVerifications.inc({ outcome: "ok" });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    emitAuthAudit({
      action: "email_verification_requested",
      outcome: "failed",
      userId,
      errorMessage: msg,
    });
    emailVerifications.inc({ outcome: "failed" });

    return { ok: false, code: "SERVICE_ERROR", message: msg };
  }
}
