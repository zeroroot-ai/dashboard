// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * ReliabilityDiagramContent — the ADR-0022 reliability diagram UI (dashboard#98).
 * The data hook (src/hooks/useCalibration.ts) is mocked here. This file verifies:
 *   1. Loading, empty (no settled bets), populated, and error states render.
 *   2. The diagram renders a point per non-empty bucket, from real report data.
 *   3. The Brier score and summary stats surface.
 *   4. The technique filter switches which curve is drawn.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CalibrationReport } from '@/src/types/calibration';

const mockUseCalibration = vi.fn();
vi.mock('@/src/hooks/useCalibration', () => ({
  useCalibration: (...args: unknown[]) => mockUseCalibration(...args),
}));

import { ReliabilityDiagramContent } from '../ReliabilityDiagramContent';

// jsdom polyfills required to open a Radix Select.
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  vi.clearAllMocks();
});

const REPORT: CalibrationReport = {
  tenant: 't1',
  overall: {
    technique: '',
    n: 42,
    meanPredicted: 0.61,
    observedFrequency: 0.57,
    brierScore: 0.182,
    bins: [
      { low: 0, high: 0.5, n: 20, meanPredicted: 0.3, observedFrequency: 0.25 },
      { low: 0.5, high: 1, n: 22, meanPredicted: 0.88, observedFrequency: 0.86 },
    ],
  },
  byTechnique: [
    {
      technique: 'http-probe',
      n: 10,
      meanPredicted: 0.7,
      observedFrequency: 0.6,
      brierScore: 0.22,
      bins: [{ low: 0.5, high: 1, n: 10, meanPredicted: 0.7, observedFrequency: 0.6 }],
    },
  ],
  unscored: 3,
  bins: 10,
};

describe('ReliabilityDiagramContent', () => {
  it('renders a loading state while the query is in flight', () => {
    mockUseCalibration.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<ReliabilityDiagramContent />);
    expect(screen.getByTestId('reliability-skeleton')).toBeInTheDocument();
  });

  it('shows an empty state when no bet has settled', () => {
    mockUseCalibration.mockReturnValue({
      isLoading: false,
      data: { tenant: 't1', overall: null, byTechnique: [], unscored: 0, bins: 10 },
      error: null,
    });
    render(<ReliabilityDiagramContent />);
    expect(screen.getByText(/no settled bets/i)).toBeInTheDocument();
    expect(screen.queryByTestId('reliability-diagram')).not.toBeInTheDocument();
  });

  it('renders the diagram with a point per non-empty bucket and the Brier score', () => {
    mockUseCalibration.mockReturnValue({ isLoading: false, data: REPORT, error: null });
    render(<ReliabilityDiagramContent />);

    expect(screen.getByTestId('reliability-diagram')).toBeInTheDocument();
    expect(screen.getByTestId('reliability-diagonal')).toBeInTheDocument();
    // overall has two non-empty buckets
    expect(screen.getByTestId('reliability-point-0')).toBeInTheDocument();
    expect(screen.getByTestId('reliability-point-1')).toBeInTheDocument();
    expect(screen.queryByTestId('reliability-point-2')).not.toBeInTheDocument();
    expect(screen.getByText('0.182')).toBeInTheDocument(); // Brier score
  });

  it('filters by technique, switching which curve is drawn', async () => {
    const user = userEvent.setup({ delay: null });
    mockUseCalibration.mockReturnValue({ isLoading: false, data: REPORT, error: null });
    render(<ReliabilityDiagramContent />);

    // Default is the tenant-wide summary (two buckets).
    expect(screen.getByTestId('reliability-point-1')).toBeInTheDocument();

    await user.click(screen.getByTestId('reliability-technique-select'));
    await user.click(await screen.findByText('http-probe'));

    // http-probe has a single bucket, so the second point is gone.
    expect(screen.getByTestId('reliability-point-0')).toBeInTheDocument();
    expect(screen.queryByTestId('reliability-point-1')).not.toBeInTheDocument();
    expect(screen.getByText('0.220')).toBeInTheDocument(); // the technique's Brier score
  });

  it('renders an error state when the query fails', () => {
    mockUseCalibration.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error('network exploded'),
    });
    render(<ReliabilityDiagramContent />);
    expect(screen.getByText(/network exploded/)).toBeInTheDocument();
  });
});
