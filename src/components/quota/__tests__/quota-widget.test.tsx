/**
 * Tests for QuotaWidget. Spec plans-and-quotas-simplification R9.B.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { QuotaWidget } from '../quota-widget';

vi.mock('@/src/lib/hooks/use-tenant-quota-usage', () => ({
  useTenantQuotaUsage: vi.fn(),
}));

import { useTenantQuotaUsage } from '@/src/lib/hooks/use-tenant-quota-usage';

const mockUseTenantQuotaUsage = vi.mocked(useTenantQuotaUsage);

beforeEach(() => {
  mockUseTenantQuotaUsage.mockReset();
});

function withUsage(missionsActive: number, agentsActive: number) {
  mockUseTenantQuotaUsage.mockReturnValue({
    data: { missionsActive, agentsActive },
    isLoading: false,
    error: undefined,
  } as unknown as ReturnType<typeof useTenantQuotaUsage>);
}

describe('QuotaWidget', () => {
  it('renders nothing when both limits are 0 (unlimited)', () => {
    withUsage(0, 0);
    const { container } = render(<QuotaWidget missionsLimit={0} agentsLimit={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides a quota row whose limit is 0 but renders the other', () => {
    withUsage(2, 7);
    render(<QuotaWidget missionsLimit={10} agentsLimit={0} />);
    expect(screen.getByTestId('quota-row-missions')).toBeTruthy();
    expect(screen.queryByTestId('quota-row-agents')).toBeNull();
  });

  it('renders both rows with limits set', () => {
    withUsage(8, 47);
    render(<QuotaWidget missionsLimit={10} agentsLimit={50} />);
    expect(screen.getByTestId('quota-row-missions')).toBeTruthy();
    expect(screen.getByTestId('quota-row-agents')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('47')).toBeTruthy();
  });

  it('renders a placeholder when usage is loading', () => {
    mockUseTenantQuotaUsage.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: undefined,
    } as unknown as ReturnType<typeof useTenantQuotaUsage>);
    const { container } = render(<QuotaWidget missionsLimit={10} agentsLimit={50} />);
    expect(container.firstChild).not.toBeNull();
  });
});
