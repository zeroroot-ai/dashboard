/**
 * Tests for fetchStripePricesUncached.
 *
 * Spec stripe-billing-integration Task 32 / R7.3, graceful degrade.
 *
 * The cached export (`fetchStripePrices`) is not tested directly because
 * `unstable_cache`'s internals are framework-owned; the contract under
 * test is the inner function's graceful-degrade behaviour across the
 * three failure shapes documented in R7.3:
 *   1. STRIPE_SECRET_KEY unset → all tiers null.
 *   2. Per-tier env var unset → that tier null.
 *   3. Stripe API call fails (retrieve throws) → that tier null.
 *
 * On success the live `unit_amount` (cents) is surfaced verbatim.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const retrieveMock = vi.fn();

vi.mock('../stripe', () => ({
  getStripeClient: () => ({ prices: { retrieve: retrieveMock } }),
}));

import { fetchStripePricesUncached } from '../fetch-prices';

const ORIG_ENV = { ...process.env };

describe('fetchStripePricesUncached', () => {
  beforeEach(() => {
    retrieveMock.mockReset();
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = ORIG_ENV;
  });

  it('returns all-nulls when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_PRICE_TEAM = 'price_team_123';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_ent_456';

    const result = await fetchStripePricesUncached();

    expect(result.team).toBeNull();
    expect(result.enterprise).toBeNull();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('returns null for a tier whose price-id env var is unset', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRICE_TEAM = 'price_team_123';
    delete process.env.STRIPE_PRICE_ENTERPRISE;
    retrieveMock.mockResolvedValueOnce({ unit_amount: 9900 });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(9900);
    expect(result.enterprise).toBeNull();
    expect(retrieveMock).toHaveBeenCalledExactlyOnceWith('price_team_123');
  });

  it('returns null for a tier whose Stripe retrieve rejects', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRICE_TEAM = 'price_team_123';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_ent_456';
    retrieveMock.mockResolvedValueOnce({ unit_amount: 9900 });
    retrieveMock.mockRejectedValueOnce(new Error('stripe outage'));

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(9900);
    expect(result.enterprise).toBeNull();
  });

  it('returns null when Stripe price has no unit_amount', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRICE_TEAM = 'price_team_123';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_ent_456';
    retrieveMock.mockResolvedValue({ unit_amount: null });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBeNull();
    expect(result.enterprise).toBeNull();
  });

  it('returns live unit_amount when Stripe succeeds for both tiers', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_PRICE_TEAM = 'price_team_123';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_ent_456';
    retrieveMock.mockResolvedValueOnce({ unit_amount: 9900 });
    retrieveMock.mockResolvedValueOnce({ unit_amount: 200000 });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(9900);
    expect(result.enterprise).toBe(200000);
  });
});
