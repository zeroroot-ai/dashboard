/**
 * Tests for the card-free vs card-first billing regime in SignupForm.
 *
 * PRD dashboard#920 / issue dashboard#923: when the deployment profile has
 * `billingEnabled=false` (self-hosted / card-free), the signup form must:
 *   - render with NO plan row, NO Stripe Elements, NO PaymentElement
 *   - collect only email, password, and workspace name
 *   - NOT require a ?plan= param (the plan row is entirely absent)
 *
 * When `billingEnabled=true` (SaaS / card-first), the plan row and payment
 * method section must be present (no regression to the existing behaviour).
 *
 * Strategy: mock Stripe and all server-action imports so the component can
 * render in jsdom. Assert on DOM presence/absence of the plan row and payment
 * section — the elements are the observable contracts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Stripe mocks — must be set up before the component import so Vitest's
// module registry has them in place. `@stripe/react-stripe-js` exports hooks
// (useStripe, useElements) that return null outside a real Elements context;
// the component already handles this gracefully (paidFlow gates their use).
// ---------------------------------------------------------------------------

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue(null),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => (
    <div data-testid="stripe-payment-element">PaymentElement</div>
  ),
  useStripe: () => null,
  useElements: () => null,
}));

// ---------------------------------------------------------------------------
// Next.js navigation mock (Link uses the router)
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/signup',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Server-action mocks (signupAction / completeSignup never called in these
// render-only tests; mock to prevent import errors)
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/signup', () => ({
  signupAction: vi.fn(),
  completeSignup: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Slug / reserved-names / tenant-availability hooks — return idle state so
// workspace field renders without warnings
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/signup/use-reserved-names', () => ({
  useReservedNames: () => [],
}));

vi.mock('@/src/lib/signup/use-tenant-availability', () => ({
  useTenantAvailability: () => ({ available: null }),
}));

// sonner toast — avoid side-effect import errors
vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// confirm-card — not exercised in render tests
vi.mock('@/src/lib/billing/confirm-card', () => ({
  confirmCardSetup: vi.fn(),
}));

// server-action-skew — not exercised in render tests
vi.mock('@/src/lib/server-action-skew', () => ({
  isServerActionDeploymentSkew: vi.fn(() => false),
  reloadForDeploymentSkew: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { SignupForm } from '../signup-form';
import { DEFAULT_PASSWORD_POLICY } from '@/src/lib/zitadel/password-policy-cache';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  plan: 'team',
  planDisplayName: 'Team',
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
  publishableKey: 'pk_test_placeholder',
  pricingUrl: 'https://www.zeroroot.ai/pricing',
};

// ---------------------------------------------------------------------------
// A) Card-free profile (billingEnabled=false, self-hosted)
// ---------------------------------------------------------------------------

describe('SignupForm — card-free profile (billingEnabled=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A.1: renders the form without a plan row', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    // The plan label must not appear — plans are a SaaS concept.
    expect(screen.queryByText('Plan')).toBeNull();
    expect(screen.queryByText('Team')).toBeNull();
  });

  it('A.2: renders the form without an "Edit plan" link', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.queryByRole('link', { name: /edit plan/i })).toBeNull();
  });

  it('A.3: renders the form without the payment method section', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.queryByText('Payment method')).toBeNull();
    expect(screen.queryByTestId('stripe-payment-element')).toBeNull();
  });

  it('A.4: renders without the trial copy', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.queryByText(/14-day free trial/i)).toBeNull();
  });

  it('A.5: renders the core account fields (email, password, workspace)', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByLabelText(/work email/i)).toBeDefined();
    // Two password fields exist (Password + Confirm password); use getAllBy.
    expect(screen.getAllByLabelText(/password/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/company name/i)).toBeDefined();
  });

  it('A.6: renders the first/last name fields', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByLabelText(/first name/i)).toBeDefined();
    expect(screen.getByLabelText(/last name/i)).toBeDefined();
  });

  it('A.7: renders the ToS and Privacy checkboxes', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByLabelText(/terms of service/i)).toBeDefined();
    expect(screen.getByLabelText(/privacy policy/i)).toBeDefined();
  });

  it('A.8: renders the "Create account" submit button', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByRole('button', { name: /create account/i })).toBeDefined();
  });

  it('A.9: renders the "Sign in" link back to /login', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeDefined();
  });

  it('A.10: works when publishableKey is empty (fully card-free)', () => {
    // publishableKey empty + billingEnabled=false = no Stripe at all.
    render(
      <SignupForm
        {...BASE_PROPS}
        publishableKey=""
        pricingUrl={null}
        billingEnabled={false}
      />,
    );
    expect(screen.queryByText('Payment method')).toBeNull();
    expect(screen.getByLabelText(/work email/i)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// B) Card-first profile (billingEnabled=true, SaaS) — no regression
// ---------------------------------------------------------------------------

describe('SignupForm — card-first profile (billingEnabled=true, SaaS)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('B.1: renders the plan row with the plan name', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.getByText('Plan')).toBeDefined();
    expect(screen.getByText('Team')).toBeDefined();
  });

  it('B.2: renders the "Edit plan" link pointing to the pricingUrl', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    const editLink = screen.getByRole('link', { name: /edit plan/i });
    expect(editLink).toBeDefined();
    expect(editLink.getAttribute('href')).toBe(
      'https://www.zeroroot.ai/pricing',
    );
  });

  it('B.3: renders the payment method section (Stripe PaymentElement)', () => {
    // With billingEnabled=true and a publishableKey, loadStripe is called
    // and the component wraps in Elements (mocked to passthrough), then
    // renders PaymentElement inside the paidFlow branch.
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.getByText('Payment method')).toBeDefined();
    expect(screen.getByTestId('stripe-payment-element')).toBeDefined();
  });

  it('B.4: renders the trial copy', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.getByText(/14-day free trial/i)).toBeDefined();
  });

  it('B.5: core account fields still render (no regression)', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.getByLabelText(/work email/i)).toBeDefined();
    // Two password fields exist (Password + Confirm password); use getAllBy.
    expect(screen.getAllByLabelText(/password/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText(/company name/i)).toBeDefined();
  });

  it('B.6: "Edit plan" link is hidden when pricingUrl is null', () => {
    // pricingUrl null means even in billing-enabled mode there is no link
    // (edge case: billing on but no marketing URL — guarded by incoherence
    // check at resolver level, but the form itself handles null gracefully).
    render(
      <SignupForm {...BASE_PROPS} billingEnabled={true} pricingUrl={null} />,
    );
    expect(screen.queryByRole('link', { name: /edit plan/i })).toBeNull();
  });
});
