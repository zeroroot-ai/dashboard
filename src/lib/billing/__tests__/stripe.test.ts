/**
 * @vitest-environment node
 *
 * Tests for the billing/stripe module, focusing on validateBillingConfig()
 * key-mode guards and the test/live key mode enforcement added in
 * spec stripe-billing-integration Task 2.
 *
 * Also covers resolvePriceIdUncached — the inner (uncached) price-ID resolver
 * that replaced the env-var-based priceIdForTier in the lookup_key migration.
 *
 * The module is NOT mocked here; we import the actual implementation.
 * STRIPE_SECRET_KEY and NODE_ENV are manipulated per-test and restored
 * in afterEach via saved originals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateBillingConfig,
  resolvePriceIdUncached,
  __resetStripeClientForTests,
  __setStripeClientForTests,
} from '../stripe';

// Save original env so we can restore after each test.
const originalEnv: Record<string, string | undefined> = {};

// STRIPE_PRICE_* vars were removed from the required-env list in the
// lookup_key migration; the required set is now just the two Stripe secrets.
const REQUIRED_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
];

function saveEnv(...keys: string[]) {
  for (const key of keys) {
    originalEnv[key] = process.env[key];
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  saveEnv(
    'NODE_ENV',
    'DASHBOARD_BILLING_PAID_TIERS_ENABLED',
    'STRIPE_EXPECTED_MODE',
    ...REQUIRED_KEYS,
  );
  __resetStripeClientForTests();
});

afterEach(() => {
  restoreEnv();
  __resetStripeClientForTests();
});

// ---------------------------------------------------------------------------
// When billing is disabled, the guard is a no-op.
// ---------------------------------------------------------------------------

describe('validateBillingConfig, paid tiers disabled (default)', () => {
  it('does not throw when DASHBOARD_BILLING_PAID_TIERS_ENABLED is unset', () => {
    delete process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
    expect(() => validateBillingConfig()).not.toThrow();
  });

  it('does not throw when DASHBOARD_BILLING_PAID_TIERS_ENABLED=false', () => {
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'false';
    expect(() => validateBillingConfig()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing env var validation (existing behaviour, not regressed).
// ---------------------------------------------------------------------------

describe('validateBillingConfig, required env vars', () => {
  it('throws when paid tiers enabled but STRIPE_SECRET_KEY is missing', () => {
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => validateBillingConfig()).toThrow('STRIPE_SECRET_KEY');
  });

  it('lists all missing env vars in the error message', () => {
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    for (const key of REQUIRED_KEYS) {
      delete process.env[key];
    }
    expect(() => validateBillingConfig()).toThrow('STRIPE_SECRET_KEY');
  });

  it('does NOT require STRIPE_PRICE_TEAM / STRIPE_PRICE_ORG / STRIPE_PRICE_ENTERPRISE', () => {
    // These were required before the lookup_key migration; they must NOT
    // be required now. A fully-configured billing config with no price-id
    // env vars set must pass the startup guard.
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_EXPECTED_MODE = 'test';
    // STRIPE_PUBLISHABLE_KEY remains required (dashboard#783); set it so this
    // test isolates the STRIPE_PRICE_* removal, not the publishable-key guard.
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_abc';
    delete process.env.STRIPE_PRICE_TEAM;
    delete process.env.STRIPE_PRICE_ORG;
    delete process.env.STRIPE_PRICE_ENTERPRISE;
    expect(() => validateBillingConfig()).not.toThrow();
  });
});

describe('validateBillingConfig — explicit STRIPE_EXPECTED_MODE guard (card-first-signup / dashboard#767)', () => {
  // publishableKey: undefined → derive a mode-matching pk so the secret-key
  // assertions under test are reached; null → unset it (missing-pk case);
  // string → set verbatim (pk-mode-mismatch / bad-prefix cases).
  function setupPaidTiers(
    stripeKey: string,
    expectedMode?: string,
    publishableKey?: string | null,
  ) {
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_ENV = 'production';
    process.env.STRIPE_SECRET_KEY = stripeKey;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    // No STRIPE_PRICE_* vars — they are no longer required.
    if (publishableKey === null) {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    } else {
      process.env.STRIPE_PUBLISHABLE_KEY =
        publishableKey ?? (expectedMode === 'live' ? 'pk_live_abc' : 'pk_test_abc');
    }
    if (expectedMode === undefined) {
      delete process.env.STRIPE_EXPECTED_MODE;
    } else {
      process.env.STRIPE_EXPECTED_MODE = expectedMode;
    }
  }

  it('throws when STRIPE_EXPECTED_MODE is unset and paid tiers are on', () => {
    setupPaidTiers('sk_test_abc', undefined);
    expect(() => validateBillingConfig()).toThrow('STRIPE_EXPECTED_MODE is required');
  });

  it('throws when STRIPE_EXPECTED_MODE is an unknown value', () => {
    setupPaidTiers('sk_test_abc', 'sandbox');
    expect(() => validateBillingConfig()).toThrow('must be "test" or "live"');
  });

  it('throws when expected=live but the key is a test key', () => {
    setupPaidTiers('sk_test_abc', 'live');
    expect(() => validateBillingConfig()).toThrow('key/mode mismatch');
  });

  it('throws when expected=test but the key is a live key', () => {
    setupPaidTiers('sk_live_abc', 'test');
    expect(() => validateBillingConfig()).toThrow('key/mode mismatch');
  });

  it('throws on an unrecognised key prefix', () => {
    setupPaidTiers('pk_test_abc', 'test');
    expect(() => validateBillingConfig()).toThrow('unrecognised prefix');
  });

  it('passes when expected=test matches a test key (staging — no allowTestKey needed)', () => {
    setupPaidTiers('sk_test_abc', 'test');
    delete process.env.STRIPE_ALLOW_TEST_KEY;
    expect(() => validateBillingConfig()).not.toThrow();
  });

  it('passes when expected=live matches a live key (prod)', () => {
    setupPaidTiers('sk_live_abc', 'live');
    expect(() => validateBillingConfig()).not.toThrow();
  });

  it('accepts restricted (rk_) keys by mode', () => {
    setupPaidTiers('rk_test_abc', 'test');
    expect(() => validateBillingConfig()).not.toThrow();
  });

  // Publishable-key guards (card-first signup Payment Element / dashboard#783).
  it('throws when STRIPE_PUBLISHABLE_KEY is missing', () => {
    setupPaidTiers('sk_test_abc', 'test', null);
    expect(() => validateBillingConfig()).toThrow('STRIPE_PUBLISHABLE_KEY');
  });

  it('throws when the publishable key mode mismatches expected', () => {
    setupPaidTiers('sk_test_abc', 'test', 'pk_live_abc');
    expect(() => validateBillingConfig()).toThrow('publishable-key/mode mismatch');
  });

  it('throws on an unrecognised publishable-key prefix', () => {
    setupPaidTiers('sk_test_abc', 'test', 'whsec_nope');
    expect(() => validateBillingConfig()).toThrow(
      'STRIPE_PUBLISHABLE_KEY has an unrecognised prefix',
    );
  });

  it('passes when secret + publishable keys both match the expected mode', () => {
    setupPaidTiers('sk_live_abc', 'live', 'pk_live_abc');
    expect(() => validateBillingConfig()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolvePriceIdUncached — lookup_key resolver unit tests
// ---------------------------------------------------------------------------

describe('resolvePriceIdUncached', () => {
  const listMock = vi.fn();

  beforeEach(() => {
    listMock.mockReset();
    // Inject a stub Stripe client so prices.list is fully controlled.
    __setStripeClientForTests({
      prices: { list: listMock },
    });
  });

  afterEach(() => {
    __resetStripeClientForTests();
  });

  it('returns null when STRIPE_SECRET_KEY is unset', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const result = await resolvePriceIdUncached('team');
    expect(result).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('returns null for an unknown tier (no lookup_key)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    // 'enterprise-deploy' is contact-sales and has no LOOKUP_KEY_MAP entry.
    const result = await resolvePriceIdUncached('enterprise-deploy' as never);
    expect(result).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('calls prices.list with the correct lookup_key for each tier', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    listMock.mockResolvedValue({ data: [{ id: 'price_team_123' }] });

    const result = await resolvePriceIdUncached('team');

    expect(result).toBe('price_team_123');
    expect(listMock).toHaveBeenCalledWith({
      lookup_keys: ['gibson_team_monthly_usd'],
      active: true,
      limit: 1,
    });
  });

  it('returns null when Stripe returns an empty list (no matching price)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    listMock.mockResolvedValue({ data: [] });

    const result = await resolvePriceIdUncached('org');
    expect(result).toBeNull();
  });

  it('returns null (never throws) when prices.list rejects', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    listMock.mockRejectedValue(new Error('stripe network error'));

    const result = await resolvePriceIdUncached('enterprise');
    expect(result).toBeNull();
  });

  it('resolves the correct price ID for org tier', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    listMock.mockResolvedValue({ data: [{ id: 'price_org_456' }] });

    const result = await resolvePriceIdUncached('org');
    expect(result).toBe('price_org_456');
    expect(listMock).toHaveBeenCalledWith({
      lookup_keys: ['gibson_org_monthly_usd'],
      active: true,
      limit: 1,
    });
  });

  it('resolves the correct price ID for enterprise tier', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    listMock.mockResolvedValue({ data: [{ id: 'price_enterprise_789' }] });

    const result = await resolvePriceIdUncached('enterprise');
    expect(result).toBe('price_enterprise_789');
    expect(listMock).toHaveBeenCalledWith({
      lookup_keys: ['gibson_enterprise_monthly_usd'],
      active: true,
      limit: 1,
    });
  });
});
