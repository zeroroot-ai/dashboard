/**
 * Tests for billingEnabled() — the single source of truth for whether the
 * dashboard is wired to a Stripe-backed billing backend (dashboard#809 /
 * ADR-0050). Critical property: fail-closed (absent flag ⇒ billing OFF, the
 * on-prem default).
 */

import { describe, it, expect, afterEach } from 'vitest';

import { billingEnabled } from '../billing-enabled';

const KEY = 'DASHBOARD_BILLING_PAID_TIERS_ENABLED';
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe('billingEnabled', () => {
  it('is OFF when the flag is absent (fail-closed, on-prem default)', () => {
    delete process.env[KEY];
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for an empty string', () => {
    process.env[KEY] = '';
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for "false"', () => {
    process.env[KEY] = 'false';
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for unrecognised values', () => {
    process.env[KEY] = 'yes';
    expect(billingEnabled()).toBe(false);
  });

  it('is ON for "true"', () => {
    process.env[KEY] = 'true';
    expect(billingEnabled()).toBe(true);
  });

  it('is ON for "1"', () => {
    process.env[KEY] = '1';
    expect(billingEnabled()).toBe(true);
  });
});
