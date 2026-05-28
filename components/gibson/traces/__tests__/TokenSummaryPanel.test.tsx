/**
 * Render contract for TokenSummaryPanel: totals strip + by-model / by-agent
 * breakdown tables, abbreviated token formatting, and USD cost display.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenSummaryPanel } from '../TokenSummaryPanel';
import type { TokenSummary } from '@/src/types/trace';

const SUMMARY: TokenSummary = {
  inputTokens: 12_400,
  outputTokens: 4_800,
  totalTokens: 17_200,
  estimatedCostUsd: 0.42,
  llmCallCount: 9,
  byModel: [
    {
      model: 'claude-sonnet-4',
      inputTokens: 10_000,
      outputTokens: 4_000,
      totalTokens: 14_000,
      callCount: 6,
      estimatedCostUsd: 0.39,
    },
  ],
  byAgent: [
    {
      agentName: 'recon',
      inputTokens: 12_400,
      outputTokens: 4_800,
      totalTokens: 17_200,
      callCount: 9,
    },
  ],
};

describe('TokenSummaryPanel', () => {
  it('renders the totals strip with abbreviated tokens and USD cost', () => {
    render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.getByText('Total tokens')).toBeDefined();
    // 17.2k / 9 also appear in the by-agent row (single agent == totals here).
    expect(screen.getAllByText('17.2k').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('$0.42')).toBeDefined();
    expect(screen.getAllByText('9').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the duration stat only when provided', () => {
    const { rerender } = render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.queryByText('Duration')).toBeNull();

    rerender(<TokenSummaryPanel summary={SUMMARY} totalDurationMs={5_500} />);
    expect(screen.getByText('Duration')).toBeDefined();
    expect(screen.getByText('5.50s')).toBeDefined();
  });

  it('renders the by-model breakdown', () => {
    render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.getByText('By model')).toBeDefined();
    expect(screen.getByText('claude-sonnet-4')).toBeDefined();
    expect(screen.getByText('$0.39')).toBeDefined();
  });

  it('renders the by-agent breakdown', () => {
    render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.getByText('By agent')).toBeDefined();
    expect(screen.getByText('recon')).toBeDefined();
  });

  it('omits breakdown tables and shows zeros without NaN for an empty summary', () => {
    const empty: TokenSummary = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      llmCallCount: 0,
      byModel: [],
      byAgent: [],
    };
    render(<TokenSummaryPanel summary={empty} />);
    expect(screen.getByText('$0.00')).toBeDefined();
    expect(screen.queryByText('By model')).toBeNull();
    expect(screen.queryByText('By agent')).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('shows <$0.01 for tiny but non-zero cost', () => {
    render(<TokenSummaryPanel summary={{ ...SUMMARY, estimatedCostUsd: 0.004, byModel: [], byAgent: [] }} />);
    expect(screen.getByText('<$0.01')).toBeDefined();
  });
});
