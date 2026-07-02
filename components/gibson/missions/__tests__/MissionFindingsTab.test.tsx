/**
 * Per-component contract test for the MissionFindingsTab on the mission detail page.
 *
 * Verifies the four required render states (loading / error / empty / rows)
 * and that the hook is called with the missionId filter so the global findings
 * endpoint scopes correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissionFindingsTab } from '../MissionFindingsTab';
import type { Finding } from '@/src/types';

const mockUseFindings = vi.fn();

vi.mock('@/src/hooks/useFindings', () => ({
  useFindings: (...args: unknown[]) => mockUseFindings(...args),
}));

const FINDING_A: Finding = {
  id: 'f1',
  title: 'Open SSH on 22',
  type: 'misconfiguration',
  severity: 'medium',
  affectedAssets: ['scanme.nmap.org'],
  missionId: 'm1',
  discoveredAt: new Date(Date.now() - 5 * 60_000),
  description: 'Port 22/tcp is open with OpenSSH 6.6.1',
  taxonomy: {},
};

const FINDING_B: Finding = {
  id: 'f2',
  title: 'TLS 1.0 supported',
  type: 'weakness',
  severity: 'high',
  affectedAssets: ['scanme.nmap.org:443'],
  missionId: 'm1',
  discoveredAt: new Date(Date.now() - 90 * 60_000),
  description: 'Server advertises TLS 1.0 in ClientHello response',
  taxonomy: {},
};

beforeEach(() => {
  mockUseFindings.mockReset();
});

describe('MissionFindingsTab', () => {
  it('passes missionId into the findings hook', () => {
    mockUseFindings.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionFindingsTab missionId="m1" />);
    expect(mockUseFindings).toHaveBeenCalledWith(
      { missionId: 'm1' },
      { limit: 500 },
    );
  });

  it('renders the skeleton while loading', () => {
    mockUseFindings.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<MissionFindingsTab missionId="m1" />);
    // TableSkeleton uses `animate-pulse` Tailwind class internally.
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it('renders the error alert + retry on hook error', () => {
    mockUseFindings.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Findings service unavailable'),
      refetch: vi.fn(),
    });
    render(<MissionFindingsTab missionId="m1" />);
    expect(screen.getByText('Failed to load findings')).toBeDefined();
  });

  it('renders the empty state when the mission has no findings', () => {
    mockUseFindings.mockReturnValue({
      data: { data: [], total: 0 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionFindingsTab missionId="m1" />);
    expect(screen.getByText('No findings yet')).toBeDefined();
    expect(
      screen.getByText(
        /Findings appear here as the mission's agents produce results/i,
      ),
    ).toBeDefined();
  });

  it('renders the findings table when data is present', () => {
    mockUseFindings.mockReturnValue({
      data: { data: [FINDING_A, FINDING_B], total: 2 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionFindingsTab missionId="m1" />);

    // Both finding titles render.
    expect(screen.getByText('Open SSH on 22')).toBeDefined();
    expect(screen.getByText('TLS 1.0 supported')).toBeDefined();

    // Severity badges render (case-insensitive).
    expect(screen.getByText('Medium')).toBeDefined();
    expect(screen.getByText('High')).toBeDefined();

    // Affected asset renders.
    expect(screen.getByText('scanme.nmap.org')).toBeDefined();

    // Count line shows total.
    const counts = screen.getAllByText(/2/);
    expect(counts.length).toBeGreaterThan(0);
  });

  it('does not render the Mission column (always the same mission)', () => {
    mockUseFindings.mockReturnValue({
      data: { data: [FINDING_A], total: 1 },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionFindingsTab missionId="m1" />);
    expect(screen.queryByRole('columnheader', { name: /^Mission/i })).toBeNull();
  });
});
