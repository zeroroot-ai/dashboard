/**
 * Tests for the signup-page closed-registration gate (dashboard#925 / PRD
 * dashboard#920, Module 6).
 *
 * Behavioral properties under test:
 *
 *   A) With selfServeSignup=false (closed-registration profile), SignupPage
 *      calls redirect("/login") immediately. This is the closed-front-door
 *      posture: /signup is never reachable on an admin-locked install.
 *
 *   B) With selfServeSignup=true (open registration), SignupPage does NOT
 *      call redirect("/login"), regardless of the billing posture.
 *
 * Test strategy: SignupPage is an async Server Component. We test the redirect
 * gate by:
 *   - Mocking next/navigation so redirect() is captured rather than throwing.
 *   - Mocking getDeploymentProfile() to control the resolved posture per test.
 *   - Mocking out downstream modules (SignupForm, pricing, password-policy)
 *     so we only exercise the early-exit gate, not form rendering.
 *
 * Mock hoisting: vi.hoisted() is used for mocks whose factory references a
 * variable defined outside the factory — this is the correct Vitest pattern
 * when a mock needs to share state with tests (see Vitest docs on hoisting).
 *
 * Prior art: src/lib/__tests__/deployment-profile.test.ts,
 *            app/(public)/login/__tests__/login-form.test.tsx.
 *
 * dashboard#925 pairs with dashboard#922 (front-door "Create account"
 * conditional) — tests for that are in login-form.test.tsx. This file is the
 * route-level complement: it verifies that hitting /signup directly also
 * refuses when registration is closed, preventing bypass via a direct URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — shared state that vi.mock factories can reference.
// vi.hoisted() runs before module evaluation, so variables defined here are
// safe to use inside vi.mock() factory functions.
// ---------------------------------------------------------------------------

const { mockRedirect, mockGetDeploymentProfile } = vi.hoisted(() => {
  return {
    mockRedirect: vi.fn(),
    mockGetDeploymentProfile: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// next/navigation mock — captures redirect() calls without throwing.
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/signup',
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Deployment-profile mock.
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/deployment-profile', () => ({
  getDeploymentProfile: (...args: unknown[]) => mockGetDeploymentProfile(...args),
}));

// ---------------------------------------------------------------------------
// Pricing and password-policy mocks — avoid import-time side effects.
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/pricing-display', () => ({
  selfServeTierIds: ['solo', 'team', 'enterprise'] as const,
  pricingDisplays: [
    { id: 'solo', name: 'Solo' },
    { id: 'team', name: 'Team' },
    { id: 'enterprise', name: 'Enterprise' },
  ],
}));

vi.mock('@/src/lib/zitadel/password-policy-cache', () => ({
  DEFAULT_PASSWORD_POLICY: {
    minLength: 8,
    hasUppercase: false,
    hasLowercase: false,
    hasNumber: false,
    hasSymbol: false,
  },
}));

// ---------------------------------------------------------------------------
// SignupForm mock — not under test here.
// ---------------------------------------------------------------------------

vi.mock('./signup-form', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SignupForm: (_props: any) => null,
}));

// ---------------------------------------------------------------------------
// Subject under test (imported after mocks are in place).
// ---------------------------------------------------------------------------

import SignupPage from '../page';

// ---------------------------------------------------------------------------
// Resolved profile fixtures.
// ---------------------------------------------------------------------------

/** Closed-registration self-hosted: no signup, no billing, no marketing. */
const CLOSED_PROFILE = {
  selfServeSignup: false,
  billingEnabled: false,
  marketingUrl: null,
};

/** Open-registration self-hosted: signup on, billing off, no marketing. */
const OPEN_SELF_HOSTED_PROFILE = {
  selfServeSignup: true,
  billingEnabled: false,
  marketingUrl: null,
};

/** Full SaaS profile: signup on, billing on, marketing URL set. */
const SAAS_PROFILE = {
  selfServeSignup: true,
  billingEnabled: true,
  marketingUrl: 'https://www.zeroroot.ai',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal searchParams Promise — no plan param, simulating a direct URL hit. */
function makeSearchParams(
  params: Record<string, string> = {},
): Promise<Record<string, string | string[] | undefined>> {
  return Promise.resolve(params);
}

// ---------------------------------------------------------------------------
// A) Closed-registration gate: /signup redirects to /login
// ---------------------------------------------------------------------------

describe('SignupPage — closed-registration gate (A)', () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockGetDeploymentProfile.mockReset();
  });

  it('A.1: calls redirect("/login") when selfServeSignup is false', async () => {
    mockGetDeploymentProfile.mockReturnValue(CLOSED_PROFILE);
    await SignupPage({ searchParams: makeSearchParams() });
    expect(mockRedirect).toHaveBeenCalledWith('/login');
  });

  it('A.2: redirect is called before plan resolution — fires even with a valid plan param', async () => {
    mockGetDeploymentProfile.mockReturnValue(CLOSED_PROFILE);
    // A valid plan param should make no difference: the redirect fires first.
    await SignupPage({ searchParams: makeSearchParams({ plan: 'team' }) });
    expect(mockRedirect).toHaveBeenCalledWith('/login');
    expect(mockRedirect).toHaveBeenCalledTimes(1);
  });

  it('A.3: redirect target is exactly /login (not /, not /signup)', async () => {
    mockGetDeploymentProfile.mockReturnValue(CLOSED_PROFILE);
    await SignupPage({ searchParams: makeSearchParams() });
    const [target] = mockRedirect.mock.calls[0] ?? [];
    expect(target).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// B) Open-registration: /signup does NOT redirect to /login
// ---------------------------------------------------------------------------

describe('SignupPage — open-registration, no /login redirect (B)', () => {
  beforeEach(() => {
    mockRedirect.mockReset();
    mockGetDeploymentProfile.mockReset();
  });

  it('B.1: does NOT call redirect("/login") when selfServeSignup is true (self-hosted open)', async () => {
    mockGetDeploymentProfile.mockReturnValue(OPEN_SELF_HOSTED_PROFILE);
    await SignupPage({ searchParams: makeSearchParams() });
    const loginRedirects = mockRedirect.mock.calls.filter(
      (call) => call[0] === '/login',
    );
    expect(loginRedirects).toHaveLength(0);
  });

  it('B.2: does NOT call redirect("/login") when selfServeSignup is true (SaaS, with valid plan)', async () => {
    mockGetDeploymentProfile.mockReturnValue(SAAS_PROFILE);
    // Provide a valid plan to bypass the pricing redirect in the SaaS path.
    await SignupPage({ searchParams: makeSearchParams({ plan: 'team' }) });
    const loginRedirects = mockRedirect.mock.calls.filter(
      (call) => call[0] === '/login',
    );
    expect(loginRedirects).toHaveLength(0);
  });
});
