// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Signup rate limiter. It wraps the sliding-window limiter of
 * src/lib/rate-limiter.ts with signup key names and limits.
 *
 * The dashboard holds no shared store, so these counters live in each
 * process: the effective limit is the configured limit times the replica
 * count. The cluster-wide signup budget is in the daemon. Each signup RPC
 * passes the client IP that resolveClientIp reads, and the daemon keeps its
 * own per-IP and per-email budgets (gibson
 * internal/server/daemon/api/signup_rate_limit.go).
 *
 * Two independent counters per attempt, a violation of either trips the
 * limit. This makes abuse harder:
 *   - IP counter: 5 attempts / 15 min / source IP
 *   - Email counter: 3 attempts / 1 hour / email (SHA-256'd so the key
 *     does not leak the email plaintext if the store is dumped)
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
