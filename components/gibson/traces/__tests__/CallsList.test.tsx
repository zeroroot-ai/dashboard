// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * A row of the calls list shows no price. The one price of a model call is the
 * cost that the gateway recorded, and the detail of the call shows it.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/src/hooks/useTraces', () => ({
  useCallTranscript: () => ({ data: undefined, isLoading: false }),
}));

import { CallsList } from '../CallsList';
import type { LlmCallSummary } from '@/src/types/trace';

const call = {
  callId: 'c1',
  runId: 'r1',
  model: 'claude-opus-4',
  scopeId: 's1',
  promptTokens: 1_000_000,
  completionTokens: 1_000_000,
} as LlmCallSummary;

describe('CallsList', () => {
  it('shows the model and the tokens of a call, and no price', () => {
    const { container } = render(<CallsList calls={[call]} />);
    expect(screen.getByText('claude-opus-4')).toBeDefined();
    expect(screen.getByTitle('input / output tokens')).toBeDefined();
    expect(screen.queryByTitle('estimated cost')).toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('says when a run has no call', () => {
    render(<CallsList calls={[]} />);
    expect(screen.getByText('No LLM calls were recorded for this run.')).toBeDefined();
  });
});
