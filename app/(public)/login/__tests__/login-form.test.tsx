/**
 * Tests for the login front door (LoginForm).
 *
 * Behavioral properties under test (dashboard#922 / PRD dashboard#920):
 *
 *   A) When selfServeSignup is true, a "Create account" action is visible and
 *      links to /signup; the front door is navigable, not a dead-end.
 *   B) When selfServeSignup is false, no "Create account" action is rendered;
 *      the front door is sign-in only (closed registration).
 *   C) In both profiles, a "Sign in" action is present and initiates the
 *      Zitadel redirect via next-auth signIn("zitadel", ...).
 *   D) Double-click on Sign in is ignored (signingIn guard).
 *
 * Strategy: render the LoginForm client component with explicit props (as the
 * server page would pass them), assert on rendered output and handler calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// next-auth/react: we only care that signIn is called correctly.
const mockSignIn = vi.fn();
vi.mock('next-auth/react', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

// next/navigation: useSearchParams — no ?callbackUrl in default test renders.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
  useParams: () => ({}),
}));

// next/link: render as a plain anchor so href is inspectable.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { LoginForm } from '../login-form';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Renders LoginForm with the given selfServeSignup value. */
function renderLoginForm(selfServeSignup: boolean) {
  return render(
    <LoginForm providers={[]} selfServeSignup={selfServeSignup} />,
  );
}

// ---------------------------------------------------------------------------
// A) selfServeSignup: true — navigable front door
// ---------------------------------------------------------------------------

describe('LoginForm — selfServeSignup: true (A)', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it('A.1: renders a "Create account" link when selfServeSignup is true', () => {
    renderLoginForm(true);
    const createLink = screen.getByRole('link', { name: /create account/i });
    expect(createLink).toBeDefined();
  });

  it('A.2: "Create account" link points to /signup', () => {
    renderLoginForm(true);
    const createLink = screen.getByRole('link', { name: /create account/i });
    expect(createLink.getAttribute('href')).toBe('/signup');
  });

  it('A.3: a "Sign in" button is present alongside the "Create account" link', () => {
    renderLoginForm(true);
    // There may be two "Sign in" triggers (button + footer); getByRole picks
    // the primary button. getAllByRole catches both.
    const signInButtons = screen.getAllByRole('button', { name: /sign in/i });
    expect(signInButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('A.4: clicking "Sign in" calls signIn("zitadel") with the default callbackUrl', () => {
    renderLoginForm(true);
    const [signInBtn] = screen.getAllByRole('button', { name: /sign in/i });
    fireEvent.click(signInBtn);
    expect(mockSignIn).toHaveBeenCalledWith('zitadel', { callbackUrl: '/dashboard' });
  });

  it('A.5: clicking "Sign in" twice only fires signIn once (double-fire guard)', () => {
    // mockSignIn is synchronous here (returns undefined), so signingIn flips
    // to true after the first call and the guard blocks the second.
    renderLoginForm(true);
    const [signInBtn] = screen.getAllByRole('button', { name: /sign in/i });
    fireEvent.click(signInBtn);
    fireEvent.click(signInBtn);
    expect(mockSignIn).toHaveBeenCalledTimes(1);
  });

  it('A.6: the page is not a dead-end — a non-spinner UI is rendered', () => {
    const { container } = renderLoginForm(true);
    // The old behavior was: only a Loader2 spinner with no interactive elements
    // (auto-redirect). Verify that at least one button is present, meaning the
    // user has something to interact with before being redirected.
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// B) selfServeSignup: false — sign-in only (closed front door)
// ---------------------------------------------------------------------------

describe('LoginForm — selfServeSignup: false (B)', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it('B.1: does NOT render a "Create account" link when selfServeSignup is false', () => {
    renderLoginForm(false);
    const createLink = screen.queryByRole('link', { name: /create account/i });
    expect(createLink).toBeNull();
  });

  it('B.2: does NOT render any link to /signup', () => {
    const { container } = renderLoginForm(false);
    const signupLinks = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/signup',
    );
    expect(signupLinks).toHaveLength(0);
  });

  it('B.3: a "Sign in" button is still present when signup is disabled', () => {
    renderLoginForm(false);
    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    expect(signInBtn).toBeDefined();
  });

  it('B.4: clicking "Sign in" calls signIn("zitadel") even when signup is off', () => {
    renderLoginForm(false);
    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(signInBtn);
    expect(mockSignIn).toHaveBeenCalledWith('zitadel', { callbackUrl: '/dashboard' });
  });
});

// ---------------------------------------------------------------------------
// C) signIn is never called on mount (no auto-redirect)
// ---------------------------------------------------------------------------

describe('LoginForm — no auto-redirect on mount (C)', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
  });

  it('C.1: signIn is NOT called automatically on mount with selfServeSignup true', () => {
    renderLoginForm(true);
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('C.2: signIn is NOT called automatically on mount with selfServeSignup false', () => {
    renderLoginForm(false);
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
