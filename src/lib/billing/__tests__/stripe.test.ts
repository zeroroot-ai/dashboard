/**
 * @vitest-environment node
 *
 * Tests for the billing/stripe module — focusing on validateBillingConfig()
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
  saveEnv('NODE_ENV', 'DASHBOARD_BILLING_PAID_TIERS_ENABLED', ...REQUIRED_KEYS);
  __resetStripeClientForTests();
});

afterEach(() => {
  restoreEnv();
  __resetStripeClientForTests();
});

// ---------------------------------------------------------------------------
// When billing is disabled, the guard is a no-op.
// ---------------------------------------------------------------------------

describe('validateBillingConfig — paid tiers disabled (default)', () => {
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
// Key-mode guard tests (spec stripe-billing-integration Task 2, R8.2).
// ---------------------------------------------------------------------------

describe('validateBillingConfig — key-mode guard', () => {
  /**
   * Set all required env vars with a given stripe key.
   */
  function setupWithKey(stripeKey: string, nodeEnv: string) {
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    // NODE_ENV is normally read-only but we need to override it for tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.env as any).NODE_ENV = nodeEnv;
    process.env.STRIPE_SECRET_KEY = stripeKey;
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRICE_TEAM = 'price_team';
    process.env.STRIPE_PRICE_ORG = 'price_org';
    process.env.STRIPE_PRICE_ENTERPRISE = 'price_enterprise';
  }

  it('throws with exact message when NODE_ENV=production and sk_test_ key', () => {
    setupWithKey('sk_test_testkey123', 'production');
    expect(() => validateBillingConfig()).toThrow(
      '[billing/stripe] Production deployment detected with test-mode Stripe key',
    );
  });

  it('throws when NODE_ENV=test and sk_live_ key', () => {
    setupWithKey('sk_live_livekey123', 'test');
    expect(() => validateBillingConfig()).toThrow(
      '[billing/stripe] Non-production deployment detected with live-mode Stripe key',
    );
  });

  it('throws when NODE_ENV=development and sk_live_ key', () => {
    setupWithKey('sk_live_livekey123', 'development');
    expect(() => validateBillingConfig()).toThrow(
      '[billing/stripe] Non-production deployment detected with live-mode Stripe key',
    );
  });

  it('does NOT throw when NODE_ENV=production and sk_live_ key', () => {
    setupWithKey('sk_live_livekey123', 'production');
    expect(() => validateBillingConfig()).not.toThrow();
  });

  it('does NOT throw when NODE_ENV=test and sk_test_ key', () => {
    setupWithKey('sk_test_testkey123', 'test');
    expect(() => validateBillingConfig()).not.toThrow();
  });

  it('does NOT throw when NODE_ENV=development and sk_test_ key', () => {
    setupWithKey('sk_test_testkey123', 'development');
    expect(() => validateBillingConfig()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Missing env var validation (existing behaviour, not regressed).
// ---------------------------------------------------------------------------

describe('validateBillingConfig — required env vars', () => {
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
