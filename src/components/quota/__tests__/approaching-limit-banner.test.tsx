/**
 * Tests for ApproachingLimitBanner. Spec plans-and-quotas-simplification R9.B.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ApproachingLimitBanner } from '../approaching-limit-banner';

vi.mock('@/src/lib/hooks/use-tenant-quota-usage', () => ({
  useTenantQuotaUsage: vi.fn(),
}));

import { useTenantQuotaUsage } from '@/src/lib/hooks/use-tenant-quota-usage';

const mockUseTenantQuotaUsage = vi.mocked(useTenantQuotaUsage);

beforeEach(() => {
  mockUseTenantQuotaUsage.mockReset();
  // Reset session storage between tests.
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
      <ApproachingLimitBanner plan="team" missionsLimit={10} agentsLimit={50} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders at 80% missions usage with team upgrade CTA', () => {
    withUsage(8, 0);
    render(
      <ApproachingLimitBanner plan="team" missionsLimit={10} agentsLimit={50} />,
    );
    expect(screen.getByTestId('quota-approaching-limit-banner')).toBeTruthy();
    const cta = screen.getByTestId('quota-banner-upgrade-cta');
    expect(cta.getAttribute('href')).toContain('/billing/upgrade?target=org');
  });

  it('renders at 100% with the at-limit copy', () => {
    withUsage(50, 0);
    render(
      <ApproachingLimitBanner plan="team" missionsLimit={50} agentsLimit={50} />,
    );
    expect(screen.getByText(/hit your plan limit/i)).toBeTruthy();
  });

  it('routes enterprise tenants to contact-sales', () => {
    withUsage(0, 800);
    render(
      <ApproachingLimitBanner plan="enterprise" missionsLimit={100} agentsLimit={1000} />,
    );
    const cta = screen.getByTestId('quota-banner-upgrade-cta');
    expect(cta.getAttribute('href')).toContain('/contact-sales');
  });

  it('renders no CTA for enterprise-deploy', () => {
    withUsage(0, 0);
    // enterprise-deploy has limit=0 which suppresses the row entirely;
    // so test with an explicit limit-set for the test path.
    render(
      <ApproachingLimitBanner plan="enterprise-deploy" missionsLimit={10} agentsLimit={50} />,
    );
    // Force >=80 by setting usage above limit.
    withUsage(10, 50);
    const { rerender } = render(
      <ApproachingLimitBanner plan="enterprise-deploy" missionsLimit={10} agentsLimit={50} />,
    );
    rerender(
      <ApproachingLimitBanner plan="enterprise-deploy" missionsLimit={10} agentsLimit={50} />,
    );
    expect(screen.queryByTestId('quota-banner-upgrade-cta')).toBeNull();
  });

  it('dismisses to sessionStorage', () => {
    withUsage(8, 0);
    render(
      <ApproachingLimitBanner plan="team" missionsLimit={10} agentsLimit={50} />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect(window.sessionStorage.getItem('gibson:quota-banner-dismissed:default')).toBe('1');
  });
});
