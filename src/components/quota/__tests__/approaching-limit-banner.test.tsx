// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Tests for ApproachingLimitBanner. Spec plans-and-quotas-simplification R9.B,
 * and dashboard#226: the action points at the account link from config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ApproachingLimitBanner } from '../approaching-limit-banner';

vi.mock('@/src/lib/hooks/use-tenant-quota-usage', () => ({
  useTenantQuotaUsage: vi.fn(),
}));

import { useTenantQuotaUsage } from '@/src/lib/hooks/use-tenant-quota-usage';

const mockUseTenantQuotaUsage = vi.mocked(useTenantQuotaUsage);

/** A test fixture, not product text. */
const ACCOUNT_LINK = { url: 'https://account.example.test/portal', label: 'account-label' };

beforeEach(() => {
  mockUseTenantQuotaUsage.mockReset();
  if (typeof window !== 'undefined') {
    window.sessionStorage.clear();
  }
});

function withUsage(missions: number, agents: number) {
  mockUseTenantQuotaUsage.mockReturnValue({
    data: { missionsActive: missions, agentsActive: agents },
    isLoading: false,
    error: undefined,
  } as unknown as ReturnType<typeof useTenantQuotaUsage>);
}

describe('ApproachingLimitBanner', () => {
  it('renders nothing under 80% usage', () => {
    withUsage(5, 25);
    const { container } = render(
      <ApproachingLimitBanner missionsLimit={10} agentsLimit={50} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('links to the account URL with the label from config at 80% usage', () => {
    withUsage(8, 0);
    render(
      <ApproachingLimitBanner missionsLimit={10} agentsLimit={50} accountLink={ACCOUNT_LINK} />,
    );
    expect(screen.getByTestId('quota-approaching-limit-banner')).toBeTruthy();
    const cta = screen.getByTestId('quota-banner-upgrade-cta');
    expect(cta.getAttribute('href')).toBe(ACCOUNT_LINK.url);
    expect(cta.textContent).toContain(ACCOUNT_LINK.label);
  });

  it('shows the quota warning but no action with no account link (self-hosted)', () => {
    withUsage(8, 0);
    render(<ApproachingLimitBanner missionsLimit={10} agentsLimit={50} />);
    expect(screen.getByTestId('quota-approaching-limit-banner')).toBeTruthy();
    expect(screen.queryByTestId('quota-banner-upgrade-cta')).toBeNull();
  });

  it('renders at 100% with the at-limit copy', () => {
    withUsage(50, 0);
    render(<ApproachingLimitBanner missionsLimit={50} agentsLimit={50} />);
    expect(screen.getByText(/hit your plan limit/i)).toBeTruthy();
  });

  it('dismisses to sessionStorage', () => {
    withUsage(8, 0);
    render(<ApproachingLimitBanner missionsLimit={10} agentsLimit={50} />);
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(window.sessionStorage.getItem('gibson:quota-banner-dismissed:default')).toBe('1');
  });
});
