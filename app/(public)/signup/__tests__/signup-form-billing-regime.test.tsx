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
 * method section must be present (no regression to the existing behavior).
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
// module registry has them in place.
//
// FIDELITY (dashboard#933): the real `@stripe/react-stripe-js` hooks THROW
// "Could not find Elements context; …" when called outside an <Elements>
// provider — they do NOT return null. An earlier version of this mock
// returned null unconditionally, which let a card-free crash ship green
// (SignupForm called the hooks on the no-<Elements> path; fixed by the
// SignupFormInnerWithStripe bridge, dashboard#923 follow-up). The mock now
// mirrors the installed library: a context marks provider presence, hooks
// and <PaymentElement> throw the library's exact error shape outside it,
// and hooks resolve to null INSIDE it (deferred stripePromise not yet
// resolved), which is the state the render-only tests exercise.
// ---------------------------------------------------------------------------

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue(null),
}));

vi.mock('@stripe/react-stripe-js', () => {
  const ElementsContext = React.createContext<boolean>(false);
  // Mirrors parseElementsContext in @stripe/react-stripe-js.
  const requireElementsContext = (useCase: string): void => {
    throw new Error(
      `Could not find Elements context; You need to wrap the part of your app that ${useCase} in an <Elements> provider.`,
    );
  };
  return {
    Elements: ({ children }: { children: React.ReactNode }) => (
      <ElementsContext.Provider value={true}>{children}</ElementsContext.Provider>
    ),
    PaymentElement: () => {
      if (!React.useContext(ElementsContext)) {
        requireElementsContext('mounts <PaymentElement>');
      }
      return <div data-testid="stripe-payment-element">PaymentElement</div>;
    },
    useStripe: () => {
      if (!React.useContext(ElementsContext)) {
        requireElementsContext('calls useStripe()');
      }
      return null;
    },
    useElements: () => {
      if (!React.useContext(ElementsContext)) {
        requireElementsContext('calls useElements()');
      }
      return null;
    },
  };
});

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

import { useStripe, useElements, Elements } from '@stripe/react-stripe-js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  plan: 'team',
  planDisplayName: 'Team',
  pricingUrl: 'https://www.zeroroot.ai/pricing',
  // termsUrl / privacyUrl default to SaaS values in the base fixture.
  // Tests that exercise the self-hosted (null) path override these explicitly.
  termsUrl: 'https://www.zeroroot.ai/terms',
  privacyUrl: 'https://www.zeroroot.ai/privacy',
};

// ---------------------------------------------------------------------------
// 0) Mock fidelity — dashboard#933
//
// Guard the mock itself: if it ever regresses to null-returning hooks, these
// tests fail, and with them the guarantee that the card-free suite below
// would catch a hook call outside <Elements>.
// ---------------------------------------------------------------------------

/** Probe that calls useStripe() during render, like a buggy form body would. */
function UseStripeProbe() {
  useStripe();
  return <div>probe</div>;
}

/** Probe that calls useElements() during render. */
function UseElementsProbe() {
  useElements();
  return <div>probe</div>;
}

describe('Stripe mock fidelity (dashboard#933)', () => {
  // React logs render-phase throws via console.error; silence them so the
  // expected throws don't spam the output.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('useStripe() throws outside <Elements>, matching @stripe/react-stripe-js', () => {
    expect(() => render(<UseStripeProbe />)).toThrow(
      /Could not find Elements context/,
    );
  });

  it('useElements() throws outside <Elements>, matching @stripe/react-stripe-js', () => {
    expect(() => render(<UseElementsProbe />)).toThrow(
      /Could not find Elements context/,
    );
  });

  it('the hooks resolve (to null) inside <Elements>', () => {
    expect(() =>
      render(
        <Elements stripe={null}>
          <UseStripeProbe />
          <UseElementsProbe />
        </Elements>,
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A) Card-free profile (billingEnabled=false, self-hosted)
// ---------------------------------------------------------------------------

describe('SignupForm — card-free profile (billingEnabled=false)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The regression dashboard#933 exists to catch: with the throwing Stripe
  // mock active, a card-free render crashes loudly if ANY component in the
  // tree calls useStripe()/useElements() (or mounts <PaymentElement>)
  // without an <Elements> provider — exactly what the real library does.
  it('A.0: card-free render calls no Stripe hook outside <Elements> (dashboard#933)', () => {
    expect(() =>
      render(<SignupForm {...BASE_PROPS} billingEnabled={false} />),
    ).not.toThrow();
  });

  it('A.0b: billing enabled also renders without a Stripe hook call', () => {
    // Step one never mounts Stripe on ANY profile now — the card moved behind
    // verification — so neither regime may reach the hooks.
    expect(() =>
      render(<SignupForm {...BASE_PROPS} billingEnabled={true} />),
    ).not.toThrow();
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

  it('A.5: renders the core account fields, and NO password field', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByLabelText(/work email/i)).toBeDefined();
    expect(screen.getByLabelText(/company name/i)).toBeDefined();
    // The password moved to /signup/complete. Collecting it here would mean
    // holding a credential across the mail round-trip for an address nobody
    // had yet proven they control.
    expect(screen.queryAllByLabelText(/password/i)).toHaveLength(0);
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

  it('A.8: renders the "Continue" submit button', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    // Not "Create account": submitting sends a verification message and
    // creates nothing.
    expect(screen.getByRole('button', { name: /continue/i })).toBeDefined();
  });

  it('A.9: renders the "Sign in" link back to /login', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={false} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeDefined();
  });

  it('A.10: works with no pricing URL (fully card-free)', () => {
    render(
      <SignupForm {...BASE_PROPS} pricingUrl={null} billingEnabled={false} />,
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

  it('B.3: renders NO payment method section, even on the SaaS profile', () => {
    // This is the ordering fix. A Payment Element needs a SetupIntent, a
    // SetupIntent needs a customer, and a customer is a billing object — none
    // of which may exist for an address nobody has proven they control. The
    // card is collected on /signup/complete instead.
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.queryByText('Payment method')).toBeNull();
    expect(screen.queryByTestId('stripe-payment-element')).toBeNull();
  });

  it('B.4: renders no trial copy (there is no card on this screen)', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.queryByText(/free trial/i)).toBeNull();
  });

  it('B.5: core account fields still render, and still no password', () => {
    render(<SignupForm {...BASE_PROPS} billingEnabled={true} />);
    expect(screen.getByLabelText(/work email/i)).toBeDefined();
    expect(screen.getByLabelText(/company name/i)).toBeDefined();
    expect(screen.queryAllByLabelText(/password/i)).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// C) Marketing-link eradication — dashboard#924 / PRD dashboard#920
// ---------------------------------------------------------------------------

describe('SignupForm — marketing-link eradication (dashboard#924)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('C.1: self-hosted (termsUrl/privacyUrl null) — no off-cluster ToS link', () => {
    render(
      <SignupForm
        {...BASE_PROPS}
        billingEnabled={false}
        termsUrl={null}
        privacyUrl={null}
      />,
    );
    // The checkbox label text still renders but without an anchor element.
    expect(screen.queryByRole('link', { name: /terms of service/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /privacy policy/i })).toBeNull();
    // The plain-text fallback label is present so the checkbox is still usable.
    expect(screen.getByText(/terms of service/i)).toBeDefined();
    expect(screen.getByText(/privacy policy/i)).toBeDefined();
  });

  it('C.2: SaaS (termsUrl/privacyUrl set) — linked ToS and Privacy', () => {
    render(
      <SignupForm
        {...BASE_PROPS}
        billingEnabled={true}
        termsUrl="https://www.zeroroot.ai/terms"
        privacyUrl="https://www.zeroroot.ai/privacy"
      />,
    );
    const tosLink = screen.getByRole('link', { name: /terms of service/i });
    expect(tosLink.getAttribute('href')).toBe('https://www.zeroroot.ai/terms');
    const privacyLink = screen.getByRole('link', { name: /privacy policy/i });
    expect(privacyLink.getAttribute('href')).toBe('https://www.zeroroot.ai/privacy');
  });
});
