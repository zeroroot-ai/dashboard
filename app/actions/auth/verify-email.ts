"use server";

/**
 * verifyEmailAction
 *
 * Server Action that consumes a Better Auth email-verification token and
 * marks the user's email as verified. Called from the Server Component at
 * app/(public)/verify-email/confirm/page.tsx after extracting the token
 * from the query string.
 *
 * On success:
 *   - Emits `email_verification_completed` audit event.
 *   - Increments emailVerifications counter with outcome='ok'.
 *   - Returns { ok: true }.
 *
 * On failure:
 *   - Returns { ok: false, code: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' }.
 *   - Increments emailVerifications counter with outcome='failed'.
 *   - Emits `email_verification_completed` audit event with outcome='failed'.
 *
 * Better Auth's verifyEmail endpoint is a GET under the hood, called
 * server-to-server via auth.api.verifyEmail({ query: { token } }).
 */

import { auth } from "@/src/lib/auth-server";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { emailVerifications } from "@/src/lib/metrics/auth";

export type VerifyEmailResult =
  | { ok: true }
  | { ok: false; code: "TOKEN_EXPIRED" | "TOKEN_INVALID" };

export async function verifyEmailAction(token: string): Promise<VerifyEmailResult> {
  if (!token || typeof token !== "string") {
    emailVerifications.inc({ outcome: "failed" });
    return { ok: false, code: "TOKEN_INVALID" };
  }

  try {
    await auth.api.verifyEmail({ query: { token } });

    emitAuthAudit({
      action: "email_verification_completed",
      outcome: "ok",
      userId: "unknown", // token is opaque; we can't cheaply extract userId without DB lookup
    });
    emailVerifications.inc({ outcome: "ok" });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Classify expired vs invalid tokens. Better Auth surfaces these as
    // error messages in the thrown APIError — match common substrings.
    const isExpired =
      /expired/i.test(msg) ||
      /TOKEN_EXPIRED/i.test(msg);

    const code: "TOKEN_EXPIRED" | "TOKEN_INVALID" = isExpired
      ? "TOKEN_EXPIRED"
      : "TOKEN_INVALID";

    emitAuthAudit({
      action: "email_verification_completed",
      outcome: "failed",
      userId: "unknown",
      errorCode: code,
      errorMessage: msg,
    });
    emailVerifications.inc({ outcome: "failed" });

    return { ok: false, code };
  }
}
