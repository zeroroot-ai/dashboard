// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tests for getDeploymentProfile() — the single source of truth for
 * deployment posture (dashboard#921, ADR-0074, dashboard#226).
 *
 * Strategy: inject env via the `source` parameter so tests are isolated
 * from the real process.env and from each other.
 *
 * Three required behavioral properties:
 *   A) Self-hosted profile: no marketing host, no account link, no step text.
 *   B) SaaS profile: marketing URL, account link and step texts from config.
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

/** Minimal env for a fully self-hosted (closed-door) install. */
const SELF_HOSTED_CLOSED: Record<string, string> = {};

/** Self-hosted with open registration. */
const SELF_HOSTED_OPEN: Record<string, string> = {
  SIGNUP_SELF_SERVE: 'true',
};

/** The six step texts. The values are test fixtures, not product text. */
const STEP_TEXTS: Record<string, string> = {
  DASHBOARD_SIGNUP_STEP_TITLE: 'step-title',
  DASHBOARD_SIGNUP_STEP_TEXT: 'step-text',
  DASHBOARD_SIGNUP_STEP_BUTTON_LABEL: 'step-button',
  DASHBOARD_SIGNUP_STEP_WAITING_TEXT: 'step-waiting',
  DASHBOARD_SIGNUP_STEP_FAILURE_TEXT: 'step-failure',
  DASHBOARD_SIGNUP_STEP_RETRY_LABEL: 'step-retry',
};

/** Full SaaS profile: signup on, marketing URL, account link, step texts. */
const SAAS: Record<string, string> = {
  SIGNUP_SELF_SERVE: 'true',
  WWW_URL: 'https://www.zeroroot.ai',
  DASHBOARD_ACCOUNT_URL: 'https://account.example.test/portal',
  DASHBOARD_ACCOUNT_LINK_LABEL: 'account-label',
  ...STEP_TEXTS,
};

// ---------------------------------------------------------------------------
// A) Self-hosted profile
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — self-hosted (A)', () => {
  it('A.1: returns all-off for a minimal self-hosted install (no knobs set)', () => {
    const profile = getDeploymentProfile(SELF_HOSTED_CLOSED);
    expect(profile).toEqual({
      signupRung: 'closed',
      marketingUrl: null,
      // Never null, in either audience: docs ship self-hosted too.
      docsUrl: 'https://docs.zeroroot.ai',
      accountLink: null,
      signupStepText: null,
    });
  });

  it('A.2: the rung is closed when SIGNUP_SELF_SERVE is absent', () => {
    expect(getDeploymentProfile({}).signupRung).toBe('closed');
  });

  it('A.3: the rung is closed for an empty or blank string', () => {
    expect(getDeploymentProfile({ SIGNUP_SELF_SERVE: '' }).signupRung).toBe('closed');
    expect(getDeploymentProfile({ SIGNUP_SELF_SERVE: '  ' }).signupRung).toBe('closed');
  });

  it('A.3b: "approval" selects the approval rung, in any case, trimmed (dashboard#267)', () => {
    expect(getDeploymentProfile({ SIGNUP_SELF_SERVE: 'approval' }).signupRung).toBe('approval');
    expect(getDeploymentProfile({ SIGNUP_SELF_SERVE: ' Approval ' }).signupRung).toBe('approval');
  });

  it('A.4: open registration sets the open rung and nothing else', () => {
    const profile = getDeploymentProfile(SELF_HOSTED_OPEN);
    expect(profile.signupRung).toBe('open');
    expect(profile.marketingUrl).toBeNull();
    expect(profile.accountLink).toBeNull();
    expect(profile.signupStepText).toBeNull();
  });

  it('A.5: marketingUrl is null when WWW_URL is absent', () => {
    expect(getDeploymentProfile({}).marketingUrl).toBeNull();
  });

  it('A.6: marketingUrl is null when WWW_URL is empty', () => {
    expect(getDeploymentProfile({ WWW_URL: '' }).marketingUrl).toBeNull();
  });

  it('A.7: the old billing knob changes nothing', () => {
    const profile = getDeploymentProfile({ DASHBOARD_BILLING_PAID_TIERS_ENABLED: 'true' });
    expect(profile).not.toHaveProperty('billingEnabled');
    expect(profile.accountLink).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B) SaaS profile
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — SaaS (B)', () => {
  it('B.1: returns the full SaaS profile when all knobs are set', () => {
    const profile = getDeploymentProfile(SAAS);
    expect(profile).toEqual({
      signupRung: 'open',
      marketingUrl: 'https://www.zeroroot.ai',
      // A DIFFERENT host from marketingUrl, on purpose: the marketing site
      // serves no /docs and answers 404 for it.
      docsUrl: 'https://docs.zeroroot.ai',
      accountLink: {
        url: 'https://account.example.test/portal',
        label: 'account-label',
      },
      signupStepText: {
        title: 'step-title',
        text: 'step-text',
        buttonLabel: 'step-button',
        waitingText: 'step-waiting',
        failureText: 'step-failure',
        retryLabel: 'step-retry',
      },
    });
  });

  it('B.2: docsUrl follows DOCS_URL and is never the marketing host', () => {
    const profile = getDeploymentProfile({
      ...SAAS,
      DOCS_URL: 'https://docs.staging.zeroroot.ai/',
    });
    expect(profile.docsUrl).toBe('https://docs.staging.zeroroot.ai');
    expect(profile.docsUrl).not.toBe(profile.marketingUrl);
  });

  it('B.3: marketingUrl strips a trailing slash from WWW_URL', () => {
    const profile = getDeploymentProfile({
      ...SAAS,
      WWW_URL: 'https://www.zeroroot.ai/',
    });
    expect(profile.marketingUrl).toBe('https://www.zeroroot.ai');
  });

  it('B.4: the account link and the step texts are independent', () => {
    const onlyLink = getDeploymentProfile({
      DASHBOARD_ACCOUNT_URL: 'https://account.example.test/',
      DASHBOARD_ACCOUNT_LINK_LABEL: 'account-label',
    });
    expect(onlyLink.accountLink).not.toBeNull();
    expect(onlyLink.signupStepText).toBeNull();

    const onlyStep = getDeploymentProfile(STEP_TEXTS);
    expect(onlyStep.accountLink).toBeNull();
    expect(onlyStep.signupStepText).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C) Incoherent combinations fail closed
// ---------------------------------------------------------------------------

describe('getDeploymentProfile — incoherent combinations (C)', () => {
  it('C.1: an account URL with no label throws and names both knobs', () => {
    const call = () =>
      getDeploymentProfile({ DASHBOARD_ACCOUNT_URL: 'https://account.example.test/' });
    expect(call).toThrow(IncoherentDeploymentProfileError);
    expect(call).toThrow('DASHBOARD_ACCOUNT_URL');
    expect(call).toThrow('DASHBOARD_ACCOUNT_LINK_LABEL');
  });

  it('C.2: a label with no account URL throws', () => {
    expect(() =>
      getDeploymentProfile({ DASHBOARD_ACCOUNT_LINK_LABEL: 'account-label' }),
    ).toThrow(IncoherentDeploymentProfileError);
  });

  it('C.3: a partial set of step texts throws and names the missing ones', () => {
    const partial = { ...STEP_TEXTS };
    delete partial.DASHBOARD_SIGNUP_STEP_RETRY_LABEL;
    const call = () => getDeploymentProfile(partial);
    expect(call).toThrow(IncoherentDeploymentProfileError);
    expect(call).toThrow('DASHBOARD_SIGNUP_STEP_RETRY_LABEL');
  });

  it('C.4: the error name is IncoherentDeploymentProfileError, not a generic Error', () => {
    try {
      getDeploymentProfile({ DASHBOARD_ACCOUNT_LINK_LABEL: 'account-label' });
      expect.fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(IncoherentDeploymentProfileError);
      expect((err as Error).name).toBe('IncoherentDeploymentProfileError');
    }
  });
});
