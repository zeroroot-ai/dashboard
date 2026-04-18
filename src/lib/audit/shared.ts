/**
 * Shared audit utilities: string truncation, sensitive-key redaction.
 *
 * These primitives are consumed by both `audit/crd.ts` and `audit/auth.ts`
 * so that redaction and truncation behaviour is defined in exactly one place.
 */

/** Maximum characters for generic audit string fields (error messages etc.). */
const DEFAULT_MAX_CHARS = 512;

/**
 * Truncate `msg` to `max` characters and append `"...[truncated]"` when
 * the string exceeds the limit. Returns `undefined` when `msg` is falsy so
 * callers can spread the result into an object without creating an explicit
 * `undefined` field.
 */
export function truncate(msg: string | undefined, max = DEFAULT_MAX_CHARS): string | undefined {
  if (!msg) return undefined;
  if (msg.length <= max) return msg;
  return msg.slice(0, max) + "...[truncated]";
}

/**
 * The set of object-key names whose values must never appear in audit logs.
 * Covers both camelCase and snake_case variants of the same concepts.
 */
export const REDACT_KEYS = new Set<string>([
  "password",
  "Password",
  "token",
  "Token",
  "secret",
  "Secret",
  "cookie",
  "Cookie",
  "authorization",
  "Authorization",
  "captchaToken",
  "captcha_token",
  "verification",
  "resetToken",
  "reset_token",
  "claimToken",
  "claim_token",
  "sessionToken",
  "session_token",
]);

const REDACTED_SENTINEL = "[REDACTED]";

/**
 * Recursively walk `obj` and replace any value whose key appears in
 * `REDACT_KEYS` with the sentinel `"[REDACTED]"`.
 *
 * - Plain objects are walked depth-first (creates a shallow clone at each
 *   level so the original is never mutated).
 * - Arrays are walked element-by-element.
 * - Primitives and class instances other than plain objects / arrays are
 *   returned as-is (they cannot contain sensitive keys by structure).
 *
 * Note: the function inspects keys, not values, so it cannot detect a
 * sensitive value stored under an innocent key — callers are responsible
 * for never placing secrets in unprotected fields.
 */
export function redact(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  if (obj !== null && typeof obj === "object" && Object.getPrototypeOf(obj) === Object.prototype) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = REDACT_KEYS.has(key) ? REDACTED_SENTINEL : redact(value);
    }
    return result;
  }

  return obj;
}
