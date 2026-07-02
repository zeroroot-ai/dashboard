/**
 * Tests for BillingContent's billing-flag gating (dashboard#809 / ADR-0050).
 *
 * Plan + quota cards always render. The purchase/manage surfaces — the upgrade
 * CTA and the Stripe Customer Portal ("Manage payment") button — are gated on
 * the `billingEnabled` prop, which the server `BillingPage` derives from the
 * single source of truth (src/lib/billing/billing-enabled.ts). Fail-closed:
 * the prop defaults to false (on-prem).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { BillingContent } from '../BillingContent';

vi.mock('@/app/actions/read/getTenantQuota', () => ({
  getTenantQuotaAction: vi.fn(),
}));

import { getTenantQuotaAction } from '@/app/actions/read/getTenantQuota';

const mockQuota = vi.mocked(getTenantQuotaAction);

beforeEach(() => {
  mockQuota.mockReset();
  // "team" is a self-serve paid tier with a real upgrade target (org).
  mockQuota.mockResolvedValue({
    ok: true,
    data: {
      planId: 'team',
      concurrentMissions: 10,
      concurrentAgents: 50,
      currentConcurrentMissions: 1,
      currentConcurrentAgents: 2,
    },
  } as unknown as Awaited<ReturnType<typeof getTenantQuotaAction>>);
});

describe('BillingContent billing-flag gating', () => {
  it('hides the Manage-payment portal button and upgrade CTA when billing is disabled (on-prem default)', async () => {
    render(<BillingContent />); // billingEnabled defaults to false
    // Plan display still renders.
    await waitFor(() => expect(screen.getByText('team')).toBeTruthy());
    // Quota cards still render.
    expect(screen.getByText('Concurrent missions')).toBeTruthy();
    // Purchase/manage surfaces are suppressed.
    expect(screen.queryByText(/Manage payment/i)).toBeNull();
    expect(
      screen.getByText(/managed by your administrator/i),
    ).toBeTruthy();
  });

  it('shows the Manage-payment portal button when billing is enabled (hosted)', async () => {
    render(<BillingContent billingEnabled />);
    await waitFor(() => expect(screen.getByText('team')).toBeTruthy());
    expect(screen.getByText(/Manage payment/i)).toBeTruthy();
  });
});
