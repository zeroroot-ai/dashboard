/**
 * @vitest-environment node
 *
 * Tests for the billing/stripe module, focusing on validateBillingConfig()
 * key-mode guards and the test/live key mode enforcement added in
 * spec stripe-billing-integration Task 2.
 *
 * The module is NOT mocked here; we import the actual implementation.
 * STRIPE_SECRET_KEY and NODE_ENV are manipulated per-test and restored
 * in afterEach via saved originals.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateBillingConfig, __resetStripeClientForTests } from '../stripe';

// Save original env so we can restore after each test.
const originalEnv: Record<string, string | undefined> = {};

const REQUIRED_KEYS = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_TEAM',
  'STRIPE_PRICE_ORG',
  'STRIPE_PRICE_ENTERPRISE',
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
    process.env.STRIPE_PRICE_TEAM = 'price_team';
    process.env.STRIPE_PRICE_ORG = 'price_org';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise';
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
