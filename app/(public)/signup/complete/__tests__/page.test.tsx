// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The completion page's three doors (dashboard#79).
 *
 * A browser holding a live verified session gets the form. A browser holding
 * a SPENT session, one whose completion already succeeded, is sent to /login:
 * the account exists and signing in is the only thing left. A browser with no
 * session is sent to the one destination every verification failure shares.
 *
 * The second door is the point. The completion action used to delete the
 * cookie, Next.js re-rendered this page inside the action's response, and the
 * page called the link invalid on a customer who had just created an account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCookieStore, mockRedirect, profile, formProps } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockCookieStore: {
      store,
      get: (name: string) =>
        store.has(name) ? { name, value: store.get(name) } : undefined,
    },
    mockRedirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT:${to}`);
    }),
    profile: { signupStepText: null as null | Record<string, string> },
    formProps: { last: null as null | Record<string, unknown> },
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/src/lib/zitadel/password-policy-cache', () => ({
  DEFAULT_PASSWORD_POLICY: { minLength: 12 },
}));
vi.mock('@/src/lib/deployment-profile', () => ({
  getDeploymentProfile: () => ({ signupStepText: profile.signupStepText }),
}));
vi.mock('../complete-form', () => ({
  CompleteSignupForm: (props: Record<string, unknown>) => {
    formProps.last = props;
    return null;
  },
}));

import SignupCompletePage from '../page';
import { POST_SIGNUP_REDIRECT } from '../../types';
import {
  SIGNUP_VERIFIED_COOKIE,
  encodeVerifiedSession,
  type VerifiedSignupSession,
} from '@/src/lib/signup/verified-session';

const SESSION: VerifiedSignupSession = {
  verifiedSessionToken: 'sess-1',
  attemptId: 'aaaaaaaa-0000-0000-0000-000000000001',
  email: 'owner@example.com',
  workspaceName: 'Example',
  tier: 'team',
};

const STEP_TEXT = {
  title: 'Payment details',
  text: 'Add a card to start your workspace.',
  buttonLabel: 'Continue to payment',
};

async function landing(): Promise<string> {
  try {
    const element = (await SignupCompletePage()) as { type?: unknown; props?: Record<string, unknown> } | undefined;
    // The mocked form records its props when React renders it. A server
    // component test does not render, so the returned element is read here.
    formProps.last = element?.props ?? null;
    return 'rendered';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('REDIRECT:')) return msg.slice('REDIRECT:'.length);
    throw err;
  }
}

describe('/signup/complete page', () => {
  beforeEach(() => {
    mockCookieStore.store.clear();
    mockRedirect.mockClear();
    profile.signupStepText = null;
    formProps.last = null;
  });

  it('renders the form for a live verified session', async () => {
    mockCookieStore.store.set(SIGNUP_VERIFIED_COOKIE, encodeVerifiedSession(SESSION));
    expect(await landing()).toBe('rendered');
  });

  it('sends a spent session to /login, never to the invalid-link page', async () => {
    mockCookieStore.store.set(
      SIGNUP_VERIFIED_COOKIE,
      encodeVerifiedSession({ ...SESSION, spent: true }),
    );
    expect(await landing()).toBe(POST_SIGNUP_REDIRECT);
  });

  // The completion action sets the cookie, and Next.js renders this page again
  // inside the action's response. A spent session with a step link must open
  // on the step card, with the link to /signup/step/start. It used to be
  // redirected to /signup/step, the page for the RETURN from the step, which
  // waits for a step nobody started (staging promotion run 38403381507).
  it('shows a spent session that holds a step link the step card, never the return page', async () => {
    profile.signupStepText = STEP_TEXT;
    mockCookieStore.store.set(
      SIGNUP_VERIFIED_COOKIE,
      encodeVerifiedSession({
        ...SESSION,
        spent: true,
        stepLink: 'https://billing.example.test/step?token=t',
      }),
    );
    expect(await landing()).toBe('rendered');
    expect(mockRedirect).not.toHaveBeenCalledWith('/signup/step');
    expect(formProps.last).toMatchObject({ stepStarted: true, stepText: STEP_TEXT });
    // The client never receives the completion token or the step link.
    expect(JSON.stringify(formProps.last)).not.toContain('billing.example.test');
    expect(JSON.stringify(formProps.last)).not.toContain('sess-1');
  });

  it('sends a spent session with a step link but no step text to /login', async () => {
    mockCookieStore.store.set(
      SIGNUP_VERIFIED_COOKIE,
      encodeVerifiedSession({
        ...SESSION,
        spent: true,
        stepLink: 'https://billing.example.test/step?token=t',
      }),
    );
    expect(await landing()).toBe(POST_SIGNUP_REDIRECT);
  });

  it('sends a browser with no session to the shared failure destination', async () => {
    expect(await landing()).toBe('/signup?verify=invalid');
  });
});
