/**
 * Non-destructive PROVISIONING_TIMEOUT handling on the completion screen
 * (dashboard#962).
 *
 * When the completion action's tenant-ready wait elapses, the account, the
 * subscription and the workspace all EXIST and are still provisioning —
 * staging observed the workspace reach Ready ~2m25s in while the old handling
 * had already dropped the user back to a form with a "signup failed" toast.
 * Retrying from there lands in WORKSPACE_TAKEN / duplicate-email territory.
 *
 * These tests pin the fixed behavior, now on CompleteSignupForm (the wait
 * moved here with the rest of provisioning when signup was split so that
 * nothing is created before the address is proven): on a PROVISIONING_TIMEOUT
 * result the form KEEPS the ProvisioningPanel mounted, and does NOT toast a
 * failure or reset. A genuine hard failure (INTERNAL_ERROR) still returns to
 * the form with a toast.
 *
 * Uses the card-free profile (billingEnabled=false): no Stripe, so the submit
 * goes straight to completeSignup, which is where the wait runs.
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/signup/complete',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// ---------------------------------------------------------------------------
// Server-action mocks — the subject of these tests.
// ---------------------------------------------------------------------------

const { mockCompleteSignup, mockStartSignupPayment } = vi.hoisted(() => ({
  mockCompleteSignup: vi.fn(),
  mockStartSignupPayment: vi.fn(),
}));
vi.mock('@/app/actions/signup', () => ({
  completeSignup: mockCompleteSignup,
  startSignupPayment: mockStartSignupPayment,
  signupAction: vi.fn(),
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

import { CompleteSignupForm } from '../complete-form';
import { DEFAULT_PASSWORD_POLICY } from '@/src/lib/zitadel/password-policy-cache';
import { PROVISIONING_TIMEOUT_MESSAGE } from '../../types';

const ATTEMPT = 'aaaaaaaa-0000-0000-0000-0000000000d1';

/** Card-free (self-hosted / kind autoconfirm) props: no Stripe. */
const CARD_FREE_PROPS = {
  verified: {
    attemptId: ATTEMPT,
    email: 'ada@example.com',
    workspaceName: 'ada-security',
    tier: 'team',
  },
  passwordPolicy: DEFAULT_PASSWORD_POLICY,
  publishableKey: '',
  billingEnabled: false,
};

/** Fill the password pair and submit. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  // The password input is wrapped in a positioning <div> inside FormControl,
  // so the label associates with the div (non-labellable); query by
  // placeholder instead.
  await user.type(
    screen.getByPlaceholderText(/at least 12 characters/i),
    'Passw0rd!Test',
  );
  await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!Test');
  await user.click(screen.getByRole('button', { name: /create account/i }));
}

describe('CompleteSignupForm PROVISIONING_TIMEOUT handling (dashboard#962)', () => {
  beforeEach(() => {
    mockCompleteSignup.mockReset();
    mockStartSignupPayment.mockReset();
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
            userMessage: PROVISIONING_TIMEOUT_MESSAGE,
          },
        }),
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never asks the billing actions to run on the card-free profile', () => {
    render(<CompleteSignupForm {...CARD_FREE_PROPS} />);
    expect(mockStartSignupPayment).not.toHaveBeenCalled();
  });

  // Generous timeout: the panel's real 1s poll interval has to tick at least
  // once, and the full suite runs this file under heavy parallel load.
  it('keeps the ProvisioningPanel mounted (no toast, no form reset) on PROVISIONING_TIMEOUT', { timeout: 20_000 }, async () => {
    mockCompleteSignup.mockResolvedValue({
      ok: false,
      attemptId: ATTEMPT,
      code: 'PROVISIONING_TIMEOUT',
      userMessage: PROVISIONING_TIMEOUT_MESSAGE,
    });

    const user = userEvent.setup();
    render(<CompleteSignupForm {...CARD_FREE_PROPS} />);
    await fillAndSubmit(user);

    // The holding panel replaces the form…
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /create account/i }),
      ).not.toBeInTheDocument();
    });
    // …and eventually renders the holding ("scenic route") state from the
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
    mockCompleteSignup.mockResolvedValue({
      ok: false,
      attemptId: ATTEMPT,
      code: 'INTERNAL_ERROR',
      userMessage: 'Something went wrong on our end.',
    });

    const user = userEvent.setup();
    render(<CompleteSignupForm {...CARD_FREE_PROPS} />);
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
