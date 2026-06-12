import "server-only";

import { checkRateLimitByKey, type RateLimitConfig } from "@/src/lib/rate-limiter";

/**
 * Rate-limit presets for CRD Server Actions. Keys are stable identifiers
 *, never change them without a migration, or the existing Redis state for
 * in-flight users will drift into a parallel namespace.
 *
 * `failClosed: true` means a Redis error returns RATE_LIMITED. Anything
 * else returns ok with a warning, acceptable for actions where a Redis
 * outage shouldn't lock tenants out, not acceptable for bootstrap token
 * enumeration.
 */
export const CRD_RATE_LIMITS = {
  fetchBootstrapToken: {
    window: 300, // 5 minutes
    max: 5,
    failClosed: true,
  },
  inviteMember: {
    window: 600, // 10 minutes
    max: 20,
    failClosed: false,
  },
  provisionTenant: {
    window: 3600, // 1 hour
    max: 5,
    failClosed: false,
  },
} as const;

export type CrdRateLimitPreset = keyof typeof CRD_RATE_LIMITS;

export type RateLimitVerdict =
  | { ok: true }
  | { ok: false; retryAfter: number };

/**
 * Consume one unit from the named preset for the given userId. Returns
 * `{ ok: true }` if within budget, `{ ok: false, retryAfter }` otherwise.
 * On Redis error:
 *   - failClosed preset → returns `{ ok: false, retryAfter: window }`
 *   - fail-open preset → logs a warning and returns `{ ok: true }`
 */
export async function consumeRateLimit(
  userId: string,
  preset: CrdRateLimitPreset,
): Promise<RateLimitVerdict> {
  const spec = CRD_RATE_LIMITS[preset];
  const key = `crd:${userId}:${preset}`;
  const config: RateLimitConfig = {
    maxRequests: spec.max,
    windowSeconds: spec.window,
    algorithm: "sliding_window",
  };

  try {
    const result = await checkRateLimitByKey(key, config, { failClosed: spec.failClosed });
    if (!result.allowed) {
      return { ok: false, retryAfter: result.resetIn };
    }
    return { ok: true };
  } catch (err) {
    if (spec.failClosed) {
      console.error(
        `[crd-rate-limit] preset=${preset} userId=${userId} fail-closed denial: ${String(err)}`,
      );
      return { ok: false, retryAfter: spec.window };
    }
    console.warn(
      `[crd-rate-limit] preset=${preset} userId=${userId} fail-open allow: ${String(err)}`,
    );
    return { ok: true };
  }
}
