/**
 * Auth audit emitter.
 *
 * Emits single-line JSON events to stdout with the `[audit.auth]` prefix so
 * the Loki pipeline can parse and index them alongside CRD audit events.
 *
 * The emitter is intentionally fire-and-forget: it never throws and never
 * blocks the caller. Sensitive fields are redacted before serialisation.
 */

import { getCorrelationId } from "@/src/lib/correlation";
import { redact, truncate } from "./shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Every distinct authentication / authorisation event that can be audited.
 * The union is exhaustive — adding a new action requires updating this type
 * and the corresponding consumer (Loki alerting rules, SIEM, etc.).
 */
export type AuthActionName =
  | "signup_started"
  | "signup_completed"
  | "signup_failed"
  | "signin_succeeded"
  | "signin_failed"
  | "signin_social_started"
  | "signin_social_completed"
  | "signin_social_failed"
  | "link_social"
  | "unlink_social"
  | "account_locked"
  | "password_reset_requested"
  | "password_reset_completed"
  | "email_verification_requested"
  | "email_verification_completed"
  | "claim_completed"
  | "session_revoked"
  | "membership_added"
  | "membership_removed"
  | "org_created"
  | "org_deleted"
  | "hibp_unavailable"
  | "captcha_failed"
  | "billing_rollback";

/**
 * Shape of every auth audit record written to stdout.
 * `ts` and `correlationId` are filled automatically by `emitAuthAudit`.
 */
export interface AuthAuditEvent {
  /** ISO8601 timestamp, filled by the emitter. */
  ts: string;
  action: AuthActionName;
  outcome: "ok" | "failed" | "rate_limited" | "locked";
  /** `'anonymous'` when there is no active session. */
  userId: string;
  /** Filled from `getCorrelationId()` by the emitter. */
  correlationId: string;
  ip?: string;
  /** Truncated to 256 characters. */
  userAgent?: string;
  targetTenant?: string | null;
  errorCode?: string;
  /** Truncated to 512 characters. */
  errorMessage?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

const MAX_USER_AGENT_CHARS = 256;

/**
 * Emit an auth audit event.
 *
 * Callers provide every field except `ts` and `correlationId`, which are
 * injected automatically. The full event is run through `redact()` before
 * serialisation so no sensitive value can leak even if a caller accidentally
 * includes one in a miscellaneous field.
 *
 * Output format: a single `console.info` call with the string
 * `[audit.auth] <JSON>` — one line per event, compatible with the existing
 * Loki JSON-log pipeline.
 */
export function emitAuthAudit(
  event: Omit<AuthAuditEvent, "ts" | "correlationId">
): void {
  try {
    const payload: AuthAuditEvent = {
      ...event,
      ts: new Date().toISOString(),
      correlationId: getCorrelationId(),
      // Apply per-field truncation limits.
      userAgent: truncate(event.userAgent, MAX_USER_AGENT_CHARS) as string | undefined,
      errorMessage: truncate(event.errorMessage) as string | undefined,
    };

    // Redact sensitive keys anywhere in the object graph before logging.
    const safe = redact(payload);

    console.info(`[audit.auth] ${JSON.stringify(safe)}`);
  } catch {
    // Swallow all errors — audit must never mask the caller's result.
  }
}
