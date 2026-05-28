/**
 * Per-component contract test for the MissionTracesTab on the mission detail page.
 *
 * Verifies the four required render states (loading / error / empty / tree)
 * and that the hook is called with missionId + missionStatus so the cache
 * strategy adapts to active vs completed missions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MissionTracesTab } from '../MissionTracesTab';
import type { TraceData, TraceNode } from '@/src/types/trace';

const mockUseMissionTrace = vi.fn();

vi.mock('@/src/hooks/useTraces', () => ({
  useMissionTrace: (...args: unknown[]) => mockUseMissionTrace(...args),
  // The shared <TraceTree> renders expandable rows for generation/decision
  // nodes, which call useObservationDetail unconditionally (collapsed by
  // default → no fetch). A static collapsed-state stub keeps the tree-render
  // assertions below focused on MissionTracesTab's own behaviour.
  useObservationDetail: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
}));

function leaf(type: TraceNode['type'], id: string, name: string, durationMs = 200): TraceNode {
  return {
    id,
    name,
    type,
    startTime: new Date(),
    endTime: new Date(),
    durationMs,
    status: 'ok',
    children: [],
  };
}

const TRACE_DATA: TraceData = {
  traceId: 't-1',
  missionId: 'm1',
  startTime: new Date(),
  totalDurationMs: 5_500,
  tokenSummary: {
    inputTokens: 1200,
    outputTokens: 480,
    totalTokens: 1680,
    estimatedCostUsd: 0.005,
    llmCallCount: 3,
    byAgent: [],
    byModel: [],
  },
  decisions: [],
  traceTree: [
    {
      id: 'n1',
      name: 'recon-agent',
      type: 'agent',
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 5_500,
      status: 'ok',
      children: [
        leaf('generation', 'g1', 'gpt-4o-mini.complete', 1_200),
        {
          id: 't1',
          name: 'nmap.scan',
          type: 'tool',
          startTime: new Date(),
          endTime: new Date(),
          durationMs: 4_000,
          status: 'error',
          errorMessage: 'host unreachable',
          children: [],
        },
      ],
    },
  ],
};

beforeEach(() => {
  mockUseMissionTrace.mockReset();
});

describe('MissionTracesTab', () => {
  it('passes missionId + missionStatus into the hook', () => {
    mockUseMissionTrace.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionTracesTab missionId="m1" missionStatus="running" />);
    expect(mockUseMissionTrace).toHaveBeenCalledWith('m1', 'running');
  });

  it('renders the skeleton while loading', () => {
    mockUseMissionTrace.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    const { container } = render(<MissionTracesTab missionId="m1" />);
    expect(container.querySelector('[class*="animate-pulse"]')).not.toBeNull();
  });

  it('renders an empty state when the hook returns "not available"', () => {
    mockUseMissionTrace.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Traces not available for this mission'),
      refetch: vi.fn(),
    });
    render(<MissionTracesTab missionId="m1" />);
    expect(screen.getByText('No traces for this mission')).toBeDefined();
  });

  it('renders an error alert for other failures', () => {
    mockUseMissionTrace.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Failed to fetch traces: 503'),
      refetch: vi.fn(),
    });
    render(<MissionTracesTab missionId="m1" />);
    expect(screen.getByText('Failed to load traces')).toBeDefined();
  });

  it('renders the empty state when the trace tree is empty', () => {
    mockUseMissionTrace.mockReturnValue({
      data: { ...TRACE_DATA, traceTree: [] },
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionTracesTab missionId="m1" />);
    expect(screen.getByText('No traces yet')).toBeDefined();
  });

  it('renders the trace tree, type badges, error rows, and the token summary', () => {
    mockUseMissionTrace.mockReturnValue({
      data: TRACE_DATA,
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<MissionTracesTab missionId="m1" />);

    // Tree nodes render.
    expect(screen.getByText('recon-agent')).toBeDefined();
    expect(screen.getByText('gpt-4o-mini.complete')).toBeDefined();
    expect(screen.getByText('nmap.scan')).toBeDefined();

    // Type badges render.
    expect(screen.getByText('Agent')).toBeDefined();
    expect(screen.getByText('LLM')).toBeDefined();
    expect(screen.getByText('Tool')).toBeDefined();

    // Error message on the failed tool node renders.
    expect(screen.getByText('host unreachable')).toBeDefined();

    // Token summary panel shows LLM call count + total tokens (abbreviated).
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('1.7k')).toBeDefined();
  });
});
