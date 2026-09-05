/**
 * Signup rate limiter, wraps the existing sliding-window Redis limiter with
 * signup-specific key namespacing and limits.
 *
 * Two independent counters per attempt, a violation of either trips the
 * limit. This makes abuse harder:
 *   - IP counter: 5 attempts / 15 min / source IP
 *   - Email counter: 3 attempts / 1 hour / email (SHA-256'd so the key
 *     doesn't leak the email plaintext if Redis is dumped)
 *
 * Returns `{allowed, retryAfterMs}`. When disallowed, `retryAfterMs` is the
 * time until the MORE-LENIENT of the two limits releases (so the UI shows a
 * reasonable countdown, not the max).
 */
import { createHash } from "node:crypto";
import { checkRateLimitByKey } from "@/src/lib/rate-limiter";

interface SignupRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * Hash the email so the rate-limit key is not personally identifying.
 */
function hashEmail(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

export async function checkSignupRateLimit(
  ip: string,
  email: string,
): Promise<SignupRateLimitResult> {
  const emailKey = `signup-rl:email:${hashEmail(email)}`;
  const ipKey = `signup-rl:ip:${ip}`;

  const [ipResult, emailResult] = await Promise.all([
    checkRateLimitByKey(ipKey, {
      algorithm: "sliding_window",
      maxRequests: 5,
      windowSeconds: 15 * 60,
    }),
    checkRateLimitByKey(emailKey, {
      algorithm: "sliding_window",
      maxRequests: 3,
      windowSeconds: 60 * 60,
    }),
  ]);

  if (ipResult.allowed && emailResult.allowed) {
    return { allowed: true, retryAfterMs: 0 };
  }

  // Pick the shorter wait so the UI countdown is accurate.
  const retryAfterSeconds = Math.min(
    ipResult.allowed ? Number.POSITIVE_INFINITY : ipResult.resetIn,
    emailResult.allowed ? Number.POSITIVE_INFINITY : emailResult.resetIn,
  );
  return {
    allowed: false,
    retryAfterMs: Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1000
      : 60_000,
  };
}
