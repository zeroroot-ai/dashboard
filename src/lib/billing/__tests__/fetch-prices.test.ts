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
 *   2. lookup_key resolves to null (no active price) → that tier null.
 *   3. Stripe API call fails (retrieve throws) → that tier null.
 *
 * On success the live `unit_amount` (cents) is surfaced verbatim.
 *
 * Post-lookup_key migration: price IDs are now resolved via resolvePriceId
 * (prices.list by lookup_key) rather than process.env[PRICE_ENV_MAP[tier]].
 * The mock stubs both resolvePriceId (from '../stripe') and
 * prices.retrieve (from getStripeClient()) independently.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// vi.mock is hoisted, so mocks must be declared with vi.hoisted() to be
// accessible inside the factory before their const binding is executed.
const { retrieveMock, resolvePriceIdMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(),
  resolvePriceIdMock: vi.fn(),
}));

vi.mock('../stripe', () => ({
  getStripeClient: () => ({ prices: { retrieve: retrieveMock } }),
  resolvePriceId: resolvePriceIdMock,
}));

import { fetchStripePricesUncached } from '../fetch-prices';

const ORIG_ENV = { ...process.env };

describe('fetchStripePricesUncached', () => {
  beforeEach(() => {
    retrieveMock.mockReset();
    resolvePriceIdMock.mockReset();
    process.env = { ...ORIG_ENV };
  });
  afterEach(() => {
    process.env = ORIG_ENV;
  });

  it('returns all-nulls when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;

    const result = await fetchStripePricesUncached();

    expect(result.team).toBeNull();
    expect(result.org).toBeNull();
    expect(result.enterprise).toBeNull();
    // Early exit: resolvePriceId and retrieve are never called.
    expect(resolvePriceIdMock).not.toHaveBeenCalled();
    expect(retrieveMock).not.toHaveBeenCalled();
  });

  it('returns null for a tier whose lookup_key resolves to no active price', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    // team and org resolve successfully; enterprise resolves to null.
    resolvePriceIdMock.mockImplementation(async (tier: string) => {
      if (tier === 'team') return 'price_team_123';
      if (tier === 'org') return 'price_org_456';
      return null; // enterprise has no active price
    });
    retrieveMock.mockImplementation(async (priceId: string) => {
      if (priceId === 'price_team_123') return { unit_amount: 9900 };
      if (priceId === 'price_org_456') return { unit_amount: 499900 };
      return { unit_amount: 0 };
    });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(9900);
    expect(result.org).toBe(499900);
    expect(result.enterprise).toBeNull();
    expect(retrieveMock).toHaveBeenCalledWith('price_team_123');
    expect(retrieveMock).toHaveBeenCalledWith('price_org_456');
    expect(retrieveMock).not.toHaveBeenCalledWith(null);
  });

  it('returns null for a tier whose Stripe retrieve rejects', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    resolvePriceIdMock.mockImplementation(async (tier: string) => {
      if (tier === 'team') return 'price_team_123';
      if (tier === 'org') return 'price_org_456';
      return 'price_ent_789';
    });
    // org retrieve throws; team and enterprise succeed.
    retrieveMock.mockImplementation(async (priceId: string) => {
      if (priceId === 'price_org_456') throw new Error('stripe outage');
      if (priceId === 'price_team_123') return { unit_amount: 9900 };
      return { unit_amount: 999900 }; // enterprise
    });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(9900);
    expect(result.org).toBeNull();
    expect(result.enterprise).toBe(999900);
  });

  it('returns null when Stripe price has no unit_amount', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    resolvePriceIdMock.mockResolvedValue('price_any_123');
    retrieveMock.mockResolvedValue({ unit_amount: null });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBeNull();
    expect(result.org).toBeNull();
    expect(result.enterprise).toBeNull();
  });

  it('returns live unit_amount when Stripe succeeds for all tiers', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    resolvePriceIdMock.mockImplementation(async (tier: string) => {
      if (tier === 'team') return 'price_team_123';
      if (tier === 'org') return 'price_org_456';
      return 'price_ent_789';
    });
    retrieveMock.mockImplementation(async (priceId: string) => {
      if (priceId === 'price_team_123') return { unit_amount: 79900 };
      if (priceId === 'price_org_456') return { unit_amount: 499900 };
      return { unit_amount: 999900 };
    });

    const result = await fetchStripePricesUncached();

    expect(result.team).toBe(79900);
    expect(result.org).toBe(499900);
    expect(result.enterprise).toBe(999900);
  });
});
