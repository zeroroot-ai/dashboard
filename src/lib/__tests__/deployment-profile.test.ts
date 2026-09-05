/**
 * Tests for getDeploymentProfile() — the single source of truth for
 * deployment posture (dashboard#921 / PRD dashboard#920 / deploy ADR-0006).
 *
 * Strategy: inject env via the `source` parameter so tests are isolated
 * from the real process.env and from each other. Mirrors the test pattern
 * used in src/lib/billing/__tests__/billing-enabled.test.ts.
 *
 * Three required behavioral properties:
 *   A) Self-hosted profile (card-free, no marketing, login-only by default).
 *   B) SaaS profile (billing on, marketing URL set, signup open).
 *   C) Incoherent combinations fail closed with a loud error.
 */

import { describe, it, expect } from 'vitest';

import {
  getDeploymentProfile,
  IncoherentDeploymentProfileError,
} from '../deployment-profile';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal env for a fully self-hosted (closed-door, no billing) install. */
const SELF_HOSTED_CLOSED: Record<string, string> = {};

/** Self-hosted with open registration. */
const SELF_HOSTED_OPEN: Record<string, string> = {
  SIGNUP_SELF_SERVE: 'true',
};

/** Full SaaS profile: signup on, billing on, marketing URL set. */
const SAAS: Record<string, string> = {
  SIGNUP_SELF_SERVE: 'true',
  DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
  WWW_URL: 'https://www.zeroroot.ai',
};

// ---------------------------------------------------------------------------
// A) Self-hosted profile
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — self-hosted (A)', () => {
  it('A.1: returns all-off for a minimal self-hosted install (no knobs set)', () => {
    const profile = getDeploymentProfile(SELF_HOSTED_CLOSED);
    expect(profile).toEqual({
      selfServeSignup: false,
      billingEnabled: false,
      marketingUrl: null,
    });
  });

  it('A.2: selfServeSignup is false when SIGNUP_SELF_SERVE is absent', () => {
    expect(getDeploymentProfile({}).selfServeSignup).toBe(false);
  });

  it('A.3: selfServeSignup is false for an empty string', () => {
    expect(getDeploymentProfile({ SIGNUP_SELF_SERVE: '' }).selfServeSignup).toBe(false);
  });

  it('A.4: selfServeSignup is true when SIGNUP_SELF_SERVE is set (open registration)', () => {
    const profile = getDeploymentProfile(SELF_HOSTED_OPEN);
    expect(profile.selfServeSignup).toBe(true);
    expect(profile.billingEnabled).toBe(false);
    expect(profile.marketingUrl).toBeNull();
  });

  it('A.5: billingEnabled is false when DASHBOARD_BILLING_PAID_TIERS_ENABLED is absent', () => {
    expect(getDeploymentProfile({}).billingEnabled).toBe(false);
  });

  it('A.6: billingEnabled is false for "false"', () => {
    expect(
      getDeploymentProfile({ DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'false' }).billingEnabled,
    ).toBe(false);
  });

  it('A.7: billingEnabled is false for unrecognised values (fail-closed)', () => {
    expect(
      getDeploymentProfile({ DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'yes' }).billingEnabled,
    ).toBe(false);
  });

  it('A.8: marketingUrl is null when WWW_URL is absent', () => {
    expect(getDeploymentProfile({}).marketingUrl).toBeNull();
  });

  it('A.9: marketingUrl is null when WWW_URL is empty', () => {
    expect(getDeploymentProfile({ WWW_URL: '' }).marketingUrl).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B) SaaS profile
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — SaaS (B)', () => {
  it('B.1: returns the full SaaS profile when all knobs are set', () => {
    const profile = getDeploymentProfile(SAAS);
    expect(profile).toEqual({
      selfServeSignup: true,
      billingEnabled: true,
      marketingUrl: 'https://www.zeroroot.ai',
    });
  });

  it('B.2: billingEnabled is true for "true"', () => {
    expect(
      getDeploymentProfile({
        ...SAAS,
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
      }).billingEnabled,
    ).toBe(true);
  });

  it('B.3: billingEnabled is true for "1"', () => {
    expect(
      getDeploymentProfile({
        ...SAAS,
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: '1',
      }).billingEnabled,
    ).toBe(true);
  });

  it('B.4: marketingUrl strips a trailing slash from WWW_URL', () => {
    const profile = getDeploymentProfile({
      ...SAAS,
      WWW_URL: 'https://www.zeroroot.ai/',
    });
    expect(profile.marketingUrl).toBe('https://www.zeroroot.ai');
  });

  it('B.5: selfServeSignup is true in the SaaS profile', () => {
    expect(getDeploymentProfile(SAAS).selfServeSignup).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C) Incoherent combinations fail closed
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — incoherent combinations (C)', () => {
  it('C.1: billing-on without self-serve signup throws IncoherentDeploymentProfileError', () => {
    expect(() =>
      getDeploymentProfile({
        // No SIGNUP_SELF_SERVE
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
        WWW_URL: 'https://www.zeroroot.ai',
      }),
    ).toThrow(IncoherentDeploymentProfileError);
  });

  it('C.1: billing-on without self-serve signup error names both knobs', () => {
    expect(() =>
      getDeploymentProfile({
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
        WWW_URL: 'https://www.zeroroot.ai',
      }),
    ).toThrow('DASHBOARD_BILLING_PAID_TIERS_ENABLED');
  });

  it('C.1: billing-on without self-serve signup error mentions SIGNUP_SELF_SERVE', () => {
    expect(() =>
      getDeploymentProfile({
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
        WWW_URL: 'https://www.zeroroot.ai',
      }),
    ).toThrow('SIGNUP_SELF_SERVE');
  });

  it('C.2: billing-on without marketing URL throws IncoherentDeploymentProfileError', () => {
    expect(() =>
      getDeploymentProfile({
        SIGNUP_SELF_SERVE: 'true',
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
        // No WWW_URL
      }),
    ).toThrow(IncoherentDeploymentProfileError);
  });

  it('C.2: billing-on without marketing URL error names WWW_URL', () => {
    expect(() =>
      getDeploymentProfile({
        SIGNUP_SELF_SERVE: 'true',
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
      }),
    ).toThrow('WWW_URL');
  });

  it('C.2: billing-on without marketing URL error names the billing knob', () => {
    expect(() =>
      getDeploymentProfile({
        SIGNUP_SELF_SERVE: 'true',
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
      }),
    ).toThrow('DASHBOARD_BILLING_PAID_TIERS_ENABLED');
  });

  it('C.3: the error name is IncoherentDeploymentProfileError, not a generic Error', () => {
    try {
      getDeploymentProfile({
        DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true',
        WWW_URL: 'https://www.zeroroot.ai',
      });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IncoherentDeploymentProfileError);
      expect((err as Error).name).toBe('IncoherentDeploymentProfileError');
    }
  });
});
