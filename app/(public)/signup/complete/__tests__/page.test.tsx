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

const { mockCookieStore, mockRedirect } = vi.hoisted(() => {
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
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));
vi.mock('next/navigation', () => ({ redirect: mockRedirect }));
vi.mock('@/src/lib/zitadel/password-policy-cache', () => ({
  DEFAULT_PASSWORD_POLICY: { minLength: 12 },
}));
vi.mock('@/src/lib/billing/billing-enabled', () => ({
  billingEnabled: () => false,
}));
vi.mock('../complete-form', () => ({
  CompleteSignupForm: () => null,
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

async function landing(): Promise<string> {
  try {
    await SignupCompletePage();
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

  it('sends a browser with no session to the shared failure destination', async () => {
    expect(await landing()).toBe('/signup?verify=invalid');
  });
});
