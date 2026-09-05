/**
 * Tests for billingEnabled() — convenience shim over getDeploymentProfile().
 *
 * dashboard#921: billingEnabled() now delegates to the deployment-profile
 * resolver. Tests that turn billing ON must also set the companion knobs
 * (SIGNUP_SELF_SERVE + WWW_URL) that the resolver requires for a coherent
 * SaaS profile. A billing-on-without-signup or billing-on-without-marketing-URL
 * combination is incoherent and throws — that is intentional fail-closed
 * behavior, not a regression.
 *
 * Critical property: fail-closed (absent flag ⇒ billing OFF, the on-prem
 * default). Preserves all behavioral guarantees from the original
 * dashboard#809 / ADR-0050 spec.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { billingEnabled } from '../billing-enabled';

const BILLING_KEY = 'DASHBOARD_BILLING_PAID_TIERS_ENABLED';
const SIGNUP_KEY = 'SIGNUP_SELF_SERVE';
const WWW_KEY = 'WWW_URL';

// Capture original values so afterEach can restore them.
const origBilling = process.env[BILLING_KEY];
const origSignup = process.env[SIGNUP_KEY];
const origWww = process.env[WWW_KEY];

afterEach(() => {
  if (origBilling === undefined) delete process.env[BILLING_KEY];
  else process.env[BILLING_KEY] = origBilling;

  if (origSignup === undefined) delete process.env[SIGNUP_KEY];
  else process.env[SIGNUP_KEY] = origSignup;

  if (origWww === undefined) delete process.env[WWW_KEY];
  else process.env[WWW_KEY] = origWww;
});

describe('billingEnabled', () => {
  it('is OFF when the flag is absent (fail-closed, on-prem default)', () => {
    delete process.env[BILLING_KEY];
    delete process.env[SIGNUP_KEY];
    delete process.env[WWW_KEY];
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for an empty string', () => {
    process.env[BILLING_KEY] = '';
    delete process.env[SIGNUP_KEY];
    delete process.env[WWW_KEY];
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for "false"', () => {
    process.env[BILLING_KEY] = 'false';
    delete process.env[SIGNUP_KEY];
    delete process.env[WWW_KEY];
    expect(billingEnabled()).toBe(false);
  });

  it('is OFF for unrecognised values', () => {
    process.env[BILLING_KEY] = 'yes';
    delete process.env[SIGNUP_KEY];
    delete process.env[WWW_KEY];
    expect(billingEnabled()).toBe(false);
  });

  it('is ON for "true" (full SaaS knob set required)', () => {
    // dashboard#921: billing-on requires the SaaS companion knobs.
    process.env[BILLING_KEY] = 'true';
    process.env[SIGNUP_KEY] = 'true';
    process.env[WWW_KEY] = 'https://www.zeroroot.ai';
    expect(billingEnabled()).toBe(true);
  });

  it('is ON for "1" (full SaaS knob set required)', () => {
    process.env[BILLING_KEY] = '1';
    process.env[SIGNUP_KEY] = 'true';
    process.env[WWW_KEY] = 'https://www.zeroroot.ai';
    expect(billingEnabled()).toBe(true);
  });
});
