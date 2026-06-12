/**
 * In-process cache for the Zitadel instance password-complexity policy.
 *
 * TTL: 5 minutes. On upstream error the cache falls back to DEFAULT_PASSWORD_POLICY
 * and logs a warning, it does NOT throw, so the signup form still renders during
 * a Zitadel outage.
 *
 * No external dependencies. No module-level network calls.
 */

import 'server-only';

import type { ZitadelAdminClient, PasswordPolicy } from './admin-client';

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

/**
 * Fallback policy used when Zitadel is unreachable.
 * Values reflect a sensible baseline; the real policy is authoritative
 * once Zitadel is healthy.
 */
export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = Object.freeze({
  minLength: 12,
  hasUppercase: true,
  hasLowercase: true,
  hasNumber: true,
  hasSymbol: false,
});

// ---------------------------------------------------------------------------
// Cache state
// ---------------------------------------------------------------------------

const TTL_MS = 5 * 60 * 1_000; // 5 minutes

interface CacheEntry {
  policy: PasswordPolicy;
  fetchedAt: number;
}

/** Module-level cache. Single entry; the policy is instance-wide. */
const cache = new Map<'singleton', CacheEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the active Zitadel password complexity policy.
 *
 * Caches the result for 5 minutes. On cache miss the `client` is called once;
 * the result is stored regardless of whether a previous entry existed.
 *
 * On any upstream error: logs a warning and returns `DEFAULT_PASSWORD_POLICY`.
 * Never throws.
 */
export async function getCachedPasswordPolicy(
  client: ZitadelAdminClient,
): Promise<PasswordPolicy> {
  const now = Date.now();
  const entry = cache.get('singleton');

  if (entry && now - entry.fetchedAt < TTL_MS) {
    return entry.policy;
  }

  try {
    const policy = await client.getPasswordComplexityPolicy();
    cache.set('singleton', { policy, fetchedAt: now });
    return policy;
  } catch (err) {
    // Log the error but do not throw, the form must still render.
    console.warn(
      '[password-policy-cache] Failed to fetch password policy from Zitadel; using defaults.',
      err instanceof Error ? err.message : String(err),
    );
    return DEFAULT_PASSWORD_POLICY;
  }
}
