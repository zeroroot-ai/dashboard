// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Render contract for TokenSummaryPanel: totals strip + by-model breakdown
 * table, abbreviated token formatting, and USD cost display (gibson#755).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenSummaryPanel } from '../TokenSummaryPanel';
import type { TokenSummary } from '@/src/types/trace';

const SUMMARY: TokenSummary = {
  inputTokens: 12_400,
  outputTokens: 4_800,
  totalTokens: 17_200,
  llmCallCount: 9,
  byModel: [
    {
      model: 'claude-sonnet-4',
      inputTokens: 10_000,
      outputTokens: 4_000,
      totalTokens: 14_000,
      callCount: 6,
    },
  ],
};

describe('TokenSummaryPanel', () => {
  it('renders the totals strip with abbreviated tokens and no cost', () => {
    render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.getByText('Total tokens')).toBeDefined();
    expect(screen.getAllByText('17.2k').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/cost/i)).toBeNull();
    expect(document.body.textContent).not.toContain('$');
    expect(screen.getAllByText('9').length).toBeGreaterThanOrEqual(1);
  });

  it('renders the by-model breakdown', () => {
    render(<TokenSummaryPanel summary={SUMMARY} />);
    expect(screen.getByText('By model')).toBeDefined();
    expect(screen.getByText('claude-sonnet-4')).toBeDefined();
    expect(screen.queryByText('Cost')).toBeNull();
  });

  it('omits the by-model table and shows zeros without NaN for an empty summary', () => {
    const empty: TokenSummary = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      llmCallCount: 0,
      byModel: [],
    };
    render(<TokenSummaryPanel summary={empty} />);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('By model')).toBeNull();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
