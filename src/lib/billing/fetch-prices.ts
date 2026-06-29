/**
 * fetch-prices.ts, server-side Stripe price fetch with graceful degrade.
 *
 * Spec stripe-billing-integration Task 16 / R7.3.
 *
 * The pricing page wants the displayed monthly price to match what
 * Stripe will actually charge, not whatever number sits in plans.yaml.
 * This module wraps `prices.retrieve` for each self-serve tier in
 * `unstable_cache` with a 60-second revalidation window so the pricing
 * page doesn't hit Stripe on every render but still picks up live
 * Stripe price changes within a minute.
 *
 * Price ID resolution (post-lookup_key migration):
 *   Each tier's Stripe price ID is resolved at runtime via the stable
 *   `lookup_key` (LOOKUP_KEY_MAP / plans.yaml) using `prices.list`.
 *   No per-environment STRIPE_PRICE_* env vars are required; the same
 *   config works across every Stripe account and test/live mode.
 *
 * Graceful degrade contract (R7.3):
 *   - If STRIPE_SECRET_KEY is unset, every tier resolves to null.
 *   - If the lookup_key resolves to no active price, that tier is null.
 *   - If Stripe returns an error at any step, that tier resolves to null.
 *   - Caller (the pricing page) MUST treat null as "show the
 *     'pricing temporarily unavailable' placeholder", not the
 *     plans.yaml fallback, see R7.3.
 *
 * Cache invariants:
 *   - One cache entry covers all self-serve tiers; partial failures
 *     are reflected as nulls inside the cached object.
 *   - Cache tag is `"stripe-prices"` so a future admin tool can
 *     `revalidateTag("stripe-prices")` after a manual Stripe price
 *     update without restarting the dashboard.
 */

import 'server-only';

import { unstable_cache } from 'next/cache';

import { logger } from '@/src/lib/logger';
import { BILLING_TIER_IDS, type BillingTier } from './stripe_gen';
import { getStripeClient, resolvePriceId } from './stripe';

/** Per-tier monthly price in cents, or null when unresolvable. */
type StripePriceMap = Readonly<Record<BillingTier, number | null>>;

/**
 * Internal fetch (uncached). Exposed only for the unit test; production
 * callers use the cached export below.
 */
export async function fetchStripePricesUncached(): Promise<StripePriceMap> {
  // Pre-empt: if the Stripe key is unset, return all-nulls without ever
  // invoking the Stripe client (which throws on missing key).
  if (!process.env.STRIPE_SECRET_KEY) {
    logger.warn(
      { tiers: BILLING_TIER_IDS.length },
      '[billing/fetch-prices] STRIPE_SECRET_KEY unset; returning null for all tiers',
    );
    const allNull: Partial<Record<BillingTier, number | null>> = {};
    for (const t of BILLING_TIER_IDS) allNull[t] = null;
    return allNull as StripePriceMap;
  }

  const result: Partial<Record<BillingTier, number | null>> = {};

  // Fetch all tiers in parallel; per-tier failures are isolated.
  const fetches = BILLING_TIER_IDS.map(async (tier) => {
    // Resolve the live price ID via the tier's stable lookup_key.
    const priceId = await resolvePriceId(tier);
    if (!priceId) {
      logger.warn(
        { tier },
        '[billing/fetch-prices] lookup_key resolved to no active price; resolving tier to null',
      );
      return [tier, null] as const;
    }
    try {
      const price = await getStripeClient().prices.retrieve(priceId);
      if (typeof price.unit_amount !== 'number') {
        logger.warn(
          { tier, priceId, priceObjectShape: typeof price.unit_amount },
          '[billing/fetch-prices] Stripe price has no unit_amount; resolving tier to null',
        );
        return [tier, null] as const;
      }
      return [tier, price.unit_amount] as const;
    } catch (err) {
      logger.warn(
        {
          tier,
          priceId,
          err: err instanceof Error ? err.message : String(err),
        },
        '[billing/fetch-prices] Stripe prices.retrieve failed; resolving tier to null',
      );
      return [tier, null] as const;
    }
  });

  const settled = await Promise.all(fetches);
  for (const [tier, value] of settled) result[tier] = value;
  return result as StripePriceMap;
}

/**
 * Cached server-side Stripe price fetch.
 *
 * Caching delivered via `unstable_cache` with a 60-second revalidation
 * window. A single cache entry is shared across all callers; the keying
 * argument is empty because the input space is trivial (no per-request
 * variation).
 */
export const fetchStripePrices = unstable_cache(
  fetchStripePricesUncached,
  ['stripe-prices'],
  {
    revalidate: 60,
    tags: ['stripe-prices'],
  },
);
