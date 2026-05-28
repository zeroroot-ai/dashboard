/**
 * Contract test for the shared <TraceTree>: static rows for non-LLM nodes,
 * expandable conversation drill-down for generation/decision nodes, and the
 * loading / error / content states of that drill-down. The drill-down hook
 * (useObservationDetail) is mocked so the test stays a pure render contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TraceNode } from '@/src/types/trace';

const mockUseObservationDetail = vi.fn();

vi.mock('@/src/hooks/useTraces', () => ({
  useObservationDetail: (...args: unknown[]) => mockUseObservationDetail(...args),
}));

import { TraceTree } from '../TraceTree';

function node(partial: Partial<TraceNode> & { id: string; type: TraceNode['type'] }): TraceNode {
  return {
    name: partial.id,
    startTime: new Date(),
    endTime: new Date(),
    durationMs: 100,
    status: 'ok',
    children: [],
    ...partial,
  };
}

beforeEach(() => {
  mockUseObservationDetail.mockReset();
  mockUseObservationDetail.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
  });
});

describe('TraceTree', () => {
  it('renders a static (non-expandable) row for non-LLM nodes', () => {
    render(
      <TraceTree nodes={[node({ id: 'tool-1', type: 'tool', name: 'nmap.scan' })]} />,
    );
    expect(screen.getByText('nmap.scan')).toBeDefined();
    // A static row is not a button.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders generation/decision nodes as expandable buttons', () => {
    render(
      <TraceTree
        nodes={[node({ id: 'g1', type: 'generation', name: 'gpt-4o.complete' })]}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('gpt-4o.complete')).toBeDefined();
  });

  it('does not fetch observation detail until the row is expanded', () => {
    render(
      <TraceTree nodes={[node({ id: 'g1', type: 'generation' })]} />,
    );
    // Hook is called (collapsed), but with enabled=false.
    expect(mockUseObservationDetail).toHaveBeenCalledWith('g1', false);
  });

  it('shows a loading skeleton while the expanded conversation loads', () => {
    mockUseObservationDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const { container } = render(
      <TraceTree nodes={[node({ id: 'g1', type: 'generation' })]} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it('renders an inline error when the conversation fails to load', () => {
    mockUseObservationDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<TraceTree nodes={[node({ id: 'g1', type: 'generation' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/Could not load this call/i)).toBeDefined();
  });

  it('renders the conversation when content is available', () => {
    mockUseObservationDetail.mockReturnValue({
      data: {
        id: 'g1',
        contentAvailable: true,
        messages: [{ role: 'user', content: 'find open ports' }],
        metadata: { model: 'gpt-4o', inputTokens: 100, outputTokens: 40, latencyMs: 200, estimatedCostUsd: 0 },
      },
      isLoading: false,
      isError: false,
    });
    render(<TraceTree nodes={[node({ id: 'g1', type: 'generation' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('find open ports')).toBeDefined();
  });

  it('explains when content logging was disabled for the call', () => {
    mockUseObservationDetail.mockReturnValue({
      data: {
        id: 'g1',
        contentAvailable: false,
        messages: [],
        metadata: { model: 'gpt-4o', inputTokens: 0, outputTokens: 0, latencyMs: 0, estimatedCostUsd: 0 },
      },
      isLoading: false,
      isError: false,
    });
    render(<TraceTree nodes={[node({ id: 'g1', type: 'generation' })]} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/content logging is disabled/i)).toBeDefined();
  });

  it('recurses into children with one renderer', () => {
    render(
      <TraceTree
        nodes={[
          node({
            id: 'agent-1',
            type: 'agent',
            name: 'recon-agent',
            children: [node({ id: 'g1', type: 'generation', name: 'llm.call' })],
          }),
        ]}
      />,
    );
    expect(screen.getByText('recon-agent')).toBeDefined();
    expect(screen.getByText('llm.call')).toBeDefined();
    // The child generation node is the only expandable row.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
