/**
 * Non-destructive PROVISIONING_TIMEOUT handling in SignupForm (dashboard#962).
 *
 * When the signup action's tenant-ready wait elapses, the Zitadel user,
 * Stripe customer, trialing subscription, and Tenant CR all EXIST and are
 * still provisioning — staging observed the Tenant CR reach Ready ~2m25s in
 * while the old handling had already dropped the user back to the signup form
 * with a "signup failed" toast. Retrying from there lands in WORKSPACE_TAKEN /
 * duplicate-email territory.
 *
 * These tests pin the fixed behavior: on a PROVISIONING_TIMEOUT result the
 * form KEEPS the ProvisioningPanel mounted (the panel reads terminalState
 * "timeout" from the progress store and renders the "we'll email you" holding
 * state), and does NOT toast a failure or reset back to the form. A genuine
 * hard failure (INTERNAL_ERROR) still returns to the form with a toast.
 *
 * Uses the card-free (autoconfirm) path: billingEnabled=false renders without
 * Stripe Elements and submits straight through signupAction, which is where
 * the inline provisioning wait runs. The card-first path shares the same
 * isNonFatalTimeout branch on the completeSignup result.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Stripe mocks — the card-free path never touches them, but the module
// imports must resolve.
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
// Server-action mocks — the subject of these tests.
// ---------------------------------------------------------------------------

const { mockSignupAction, mockCompleteSignup } = vi.hoisted(() => ({
  mockSignupAction: vi.fn(),
  mockCompleteSignup: vi.fn(),
}));
vi.mock('@/app/actions/signup', () => ({
  signupAction: mockSignupAction,
  completeSignup: mockCompleteSignup,
}));

// Slug / reserved-names / tenant-availability hooks — idle state.
vi.mock('@/src/lib/signup/use-reserved-names', () => ({
  // Real hook returns a ReservedNamesDenylist ({exact, prefix}); these tests
  // type a workspace name, so isReservedSlug dereferences both fields.
  useReservedNames: () => ({ exact: [], prefix: [] }),
}));
vi.mock('@/src/lib/signup/use-tenant-availability', () => ({
  useTenantAvailability: () => ({ available: null }),
}));

// sonner toast — spy: the timeout path must NOT toast an error.
const { mockToastError } = vi.hoisted(() => ({ mockToastError: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { error: mockToastError, success: vi.fn() },
}));

vi.mock('@/src/lib/billing/confirm-card', () => ({
  confirmCardSetup: vi.fn(),
}));

vi.mock('@/src/lib/server-action-skew', () => ({
  isServerActionDeploymentSkew: vi.fn(() => false),
  reloadForDeploymentSkew: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Subject under test
// ---------------------------------------------------------------------------

import { SignupForm } from '../signup-form';
import { DEFAULT_PASSWORD_POLICY } from '@/src/lib/zitadel/password-policy-cache';

// Card-free (self-hosted / kind autoconfirm) props: no Stripe, no plan row.
const CARD_FREE_PROPS = {
  plan: 'team',
  planDisplayName: 'Team',
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
  publishableKey: '',
  pricingUrl: null,
  billingEnabled: false,
  termsUrl: null,
  privacyUrl: null,
};

/** Fill every required field and submit. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/first name/i), 'Ada');
  await user.type(screen.getByLabelText(/last name/i), 'Lovelace');
  await user.type(screen.getByLabelText(/work email/i), 'ada@example.com');
  // The password input is wrapped in a positioning <div> inside FormControl,
  // so the label associates with the div (non-labellable); query by
  // placeholder instead.
  await user.type(
    screen.getByPlaceholderText(/at least 12 characters/i),
    'Passw0rd!Test',
  );
  await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!Test');
  await user.type(screen.getByLabelText(/company name/i), 'ada-security');
  await user.click(screen.getByLabelText(/terms of service/i));
  await user.click(screen.getByLabelText(/privacy policy/i));
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('SignupForm PROVISIONING_TIMEOUT handling (dashboard#962)', () => {
  beforeEach(() => {
    mockSignupAction.mockReset();
    mockCompleteSignup.mockReset();
    mockToastError.mockClear();
    // The ProvisioningPanel polls /api/signup/progress/:id; serve the
    // terminal timeout record the server action wrote before returning.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          step: 'setup_workspace',
          stepStartedAt: Date.now(),
          terminalState: 'timeout',
          error: {
            code: 'PROVISIONING_TIMEOUT',
            userMessage:
              "Still setting up your workspace, we'll email you when it's ready.",
          },
        }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Generous timeout: the panel's real 1s poll interval has to tick at least
  // once, and the full suite runs this file under heavy parallel load.
  it('keeps the ProvisioningPanel mounted (no toast, no form reset) on PROVISIONING_TIMEOUT', { timeout: 20_000 }, async () => {
    mockSignupAction.mockResolvedValue({
      ok: false,
      attemptId: 'aaaaaaaa-0000-0000-0000-0000000000d1',
      code: 'PROVISIONING_TIMEOUT',
      userMessage:
        "Still setting up your workspace, we'll email you when it's ready.",
    });

    const user = userEvent.setup();
    render(<SignupForm {...CARD_FREE_PROPS} />);
    await fillAndSubmit(user);

    // The holding panel replaces the form…
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /create account/i }),
      ).not.toBeInTheDocument();
    });
    // …and eventually renders the "we'll email you" timeout state from the
    // progress store (panel poll interval is 1s).
    await waitFor(
      () => {
        expect(screen.getByText(/taking the scenic route/i)).toBeInTheDocument();
      },
      { timeout: 15_000 },
    );
    // Sign-in is offered as the resume path.
    expect(
      screen.getByRole('link', { name: /sign in instead/i }),
    ).toBeInTheDocument();
    // No destructive failure signal.
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('still returns to the form with a toast on a hard failure (INTERNAL_ERROR)', async () => {
    mockSignupAction.mockResolvedValue({
      ok: false,
      attemptId: 'aaaaaaaa-0000-0000-0000-0000000000d2',
      code: 'INTERNAL_ERROR',
      userMessage: 'Something went wrong on our end.',
    });

    const user = userEvent.setup();
    render(<SignupForm {...CARD_FREE_PROPS} />);
    await fillAndSubmit(user);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Something went wrong on our end.',
      );
    });
    // Form is still there for a corrected resubmit.
    expect(
      screen.getByRole('button', { name: /create account/i }),
    ).toBeInTheDocument();
  });
});
