/**
 * The signup holding state must not promise an email nobody sends
 * (dashboard#967, defect 2).
 *
 * The timeout/holding state used to read "we'll drop you an email the moment
 * your workspace is live". Nothing in the platform sends that email: the
 * tenant-operator's `mail.Sender.SendWelcome`
 * (gibson operators/tenant/internal/mail/sender.go:121) is implemented, the
 * template is compiled and SMTP is a hard boot requirement, but the method
 * has ZERO callers — the welcome path was never wired into the Tenant
 * reconcile. Tracked for the operator side in zeroroot-ai/gibson.
 *
 * These tests pin the invariant: no user-visible string on the holding
 * state — rendered copy, the aria-live announcement, or the Server Action's
 * PROVISIONING_TIMEOUT message — may claim an email is coming until a
 * sender actually exists. When the operator-side welcome mail lands, delete
 * these tests in the same change set that restores the promise.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import { ProvisioningPanel } from '../provisioning-panel';
import { PROVISIONING_TIMEOUT_MESSAGE } from '../types';

const ATTEMPT_ID = '11111111-2222-4333-8444-555555555555';

// Any user-visible claim that a message will be delivered out of band.
const EMAIL_PROMISE_RE = /e-?mail|inbox|notify you|we'?ll let you know/i;

function mockTimeoutPoll() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      step: 'setup_workspace',
      stepStartedAt: Date.now(),
      terminalState: 'timeout',
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ProvisioningPanel holding state (dashboard#967)', () => {
  beforeEach(() => {
    mockTimeoutPoll();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the holding state without promising an email', async () => {
    const { container } = render(
      <ProvisioningPanel
        attemptId={ATTEMPT_ID}
        redirectOnSuccess="/login"
        tenantSlug="acme"
        onRetry={() => {}}
      />,
    );

    await waitFor(
      () => {
        expect(screen.getByText(/still working/i)).toBeInTheDocument();
      },
      { timeout: 4_000 },
    );

    expect(container.textContent ?? '').not.toMatch(EMAIL_PROMISE_RE);
  }, 10_000);

  it('announces the holding state to screen readers without promising an email', async () => {
    render(
      <ProvisioningPanel
        attemptId={ATTEMPT_ID}
        redirectOnSuccess="/login"
        tenantSlug="acme"
        onRetry={() => {}}
      />,
    );

    const live = await waitFor(
      () => {
        const region = document.querySelector('[aria-live="polite"]');
        expect(region?.textContent).toMatch(/taking longer than expected/i);
        return region as HTMLElement;
      },
      { timeout: 4_000 },
    );

    expect(live.textContent ?? '').not.toMatch(EMAIL_PROMISE_RE);
  }, 10_000);

  it("the Server Action's PROVISIONING_TIMEOUT message promises no email", () => {
    expect(PROVISIONING_TIMEOUT_MESSAGE).not.toMatch(EMAIL_PROMISE_RE);
    // …and still tells the user the workspace is coming.
    expect(PROVISIONING_TIMEOUT_MESSAGE).toMatch(/still setting up/i);
  });
});
