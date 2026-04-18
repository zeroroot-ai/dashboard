"use server";

/**
 * checkPasswordAction
 *
 * Optional live breach-check Server Action called by the PasswordStrength
 * component during sign-up. Accepts a plaintext password, delegates to the
 * HIBP k-anonymity range API via `isPasswordBreached`, and returns a typed
 * result the client renders as a UX hint.
 *
 * This is NOT the authoritative gate — signUpAction owns the submit-time
 * breach check. This action exists purely to give the user early feedback
 * before they submit the form.
 *
 * Security notes:
 *   - The password is never logged or persisted here.
 *   - The Server Action RPC channel is Origin-protected by Next.js.
 *   - The k-anonymity prefix approach in isPasswordBreached ensures only the
 *     first 5 SHA-1 hex chars leave the server.
 *
 * Metrics / audit:
 *   - Increments `hibpChecks` counter on every terminal outcome.
 *   - Emits `hibp_unavailable` audit event when the result is 'unknown'.
 */

import { isPasswordBreached } from "@/src/lib/auth/hibp";
import { hibpChecks } from "@/src/lib/metrics/auth";
import { emitAuthAudit } from "@/src/lib/audit/auth";

export type CheckPasswordResult =
  | { ok: true; breached: boolean; count?: number }
  | { ok: false; reason: string };

export async function checkPasswordAction(input: {
  password: string;
}): Promise<CheckPasswordResult> {
  const { password } = input;

  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, reason: "invalid_input" };
  }

  let result;
  try {
    result = await isPasswordBreached(password);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "internal_error";
    hibpChecks.inc({ outcome: "unknown" });
    emitAuthAudit({
      action: "hibp_unavailable",
      outcome: "failed",
      userId: "anonymous",
      reason,
    });
    return { ok: false, reason: "internal_error" };
  }

  if (result.breached === true) {
    hibpChecks.inc({ outcome: "breached" });
    return { ok: true, breached: true, count: result.count };
  }

  if (result.breached === false) {
    hibpChecks.inc({ outcome: "clean" });
    return { ok: true, breached: false, count: 0 };
  }

  // result.breached === 'unknown'
  hibpChecks.inc({ outcome: "unknown" });
  emitAuthAudit({
    action: "hibp_unavailable",
    outcome: "failed",
    userId: "anonymous",
    reason: result.reason,
  });
  return { ok: false, reason: result.reason };
}
