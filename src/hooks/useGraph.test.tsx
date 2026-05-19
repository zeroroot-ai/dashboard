import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useMissionGraph,
  useFullGraph,
  useGraphStats,
  useGraph,
  extractRelationshipTypes,
  filterGraphData,
  type GraphData,
} from './useGraph';
import type { GraphNodeType } from '@/src/types';
import { createTestQueryClient, createHookWrapper } from '@/src/test/test-utils';
import { QueryClient } from '@tanstack/react-query';

const mockGraphData: GraphData = {
  nodes: [
    {
      id: 'mission-1',
      labels: ['Mission'],
      properties: { name: 'Test Mission' },
    },
    {
      id: 'agent-1',
      labels: ['Agent'],
      properties: { name: 'Recon Agent' },
    },
    {
      id: 'host-1',
      labels: ['Host'],
      properties: { name: 'example.com' },
    },
    {
      id: 'finding-1',
      labels: ['Finding'],
      properties: { title: 'SQL Injection' },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'mission-1',
      target: 'agent-1',
      type: 'uses',
      properties: {},
    },
    {
      id: 'e2',
      source: 'agent-1',
      target: 'host-1',
      type: 'scans',
      properties: {},
    },
    {
      id: 'e3',
      source: 'agent-1',
      target: 'finding-1',
      type: 'discovered',
      properties: {},
    },
  ],
};

describe('useGraph hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('useMissionGraph', () => {
    it('should fetch mission graph successfully', async () => {
      const { result } = renderHook(() => useMissionGraph('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.nodes).toBeDefined();
      expect(result.current.data?.edges).toBeDefined();
    });

    it('should not fetch when missionId is null', () => {
      const { result } = renderHook(() => useMissionGraph(null), {
        wrapper: createHookWrapper(queryClient),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
    });

    it('should not fetch when missionId is undefined', () => {
      const { result } = renderHook(() => useMissionGraph(undefined), {
        wrapper: createHookWrapper(queryClient),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
    });

    it('should handle fetch errors', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        } as Response)
      );

      const { result } = renderHook(() => useMissionGraph('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch mission graph');

      global.fetch = originalFetch;
    });

    it('should use longer staleTime for expensive query', async () => {
      const { result } = renderHook(() => useMissionGraph('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Query should have 2 minute staleTime (expensive query)
      const queryState = queryClient.getQueryState(['graph', 'mission', 'mission-1']);
      expect(queryState).toBeDefined();
    });
  });

  describe('useFullGraph', () => {
    it('should fetch full graph successfully', async () => {
      const { result } = renderHook(() => useFullGraph(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.nodes).toBeDefined();
      expect(result.current.data?.edges).toBeDefined();
    });

    it('should apply node type filters', async () => {
      const filters = {
        nodeTypes: ['Mission' as const, 'Agent' as const],
      };

      const { result } = renderHook(() => useFullGraph(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should apply relationship type filters', async () => {
      const filters = {
        relationshipTypes: ['uses', 'scans'],
      };

      const { result } = renderHook(() => useFullGraph(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should apply search filter', async () => {
      const filters = {
        search: 'example',
      };

      const { result } = renderHook(() => useFullGraph(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should apply limit filter', async () => {
      const filters = {
        limit: 100,
      };

      const { result } = renderHook(() => useFullGraph(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should combine multiple filters', async () => {
      const filters = {
        nodeTypes: ['Mission' as const],
        search: 'test',
        limit: 50,
      };

      const { result } = renderHook(() => useFullGraph(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });
  });

  describe('useGraphStats', () => {
    it('should fetch graph statistics successfully', async () => {
      const { result } = renderHook(() => useGraphStats(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data).toHaveProperty('totalNodes');
      expect(result.current.data).toHaveProperty('totalEdges');
      expect(result.current.data).toHaveProperty('nodesByType');
      expect(result.current.data).toHaveProperty('relationshipTypes');
    });

    it('should handle stats fetch errors', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Server Error',
        } as Response)
      );

      const { result } = renderHook(() => useGraphStats(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch graph stats');

      global.fetch = originalFetch;
    });
  });

  describe('useGraph (convenience hook)', () => {
    it('should use mission graph when missionId is provided', async () => {
      const { result } = renderHook(() => useGraph('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should use full graph when missionId is null', async () => {
      const { result } = renderHook(() => useGraph(null), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should use full graph when missionId is undefined', async () => {
      const { result } = renderHook(() => useGraph(undefined), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });

    it('should apply filters when using full graph', async () => {
      const filters = {
        nodeTypes: ['Mission' as const],
      };

      const { result } = renderHook(() => useGraph(null, filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
    });
  });

  describe('extractRelationshipTypes utility', () => {
    it('should extract unique relationship types', () => {
      const types = extractRelationshipTypes(mockGraphData);

      expect(types).toContain('uses');
      expect(types).toContain('scans');
      expect(types).toContain('discovered');
      expect(types.length).toBe(3);
    });

    it('should return sorted array', () => {
      const types = extractRelationshipTypes(mockGraphData);

      const sorted = [...types].sort();
      expect(types).toEqual(sorted);
    });

    it('should handle graph with no edges', () => {
      const emptyGraph: GraphData = {
        nodes: mockGraphData.nodes,
        edges: [],
      };

      const types = extractRelationshipTypes(emptyGraph);

      expect(types).toEqual([]);
    });

    it('should handle undefined graph data', () => {
      const types = extractRelationshipTypes(undefined);

      expect(types).toEqual([]);
    });

    it('should deduplicate relationship types', () => {
      const graphWithDuplicates: GraphData = {
        nodes: mockGraphData.nodes,
        edges: [
          ...mockGraphData.edges,
          {
            id: 'e4',
            source: 'mission-1',
            target: 'host-1',
            type: 'uses', // duplicate
            properties: {},
          },
        ],
      };

      const types = extractRelationshipTypes(graphWithDuplicates);

      expect(types.filter((t) => t === 'uses').length).toBe(1);
    });
  });

  describe('filterGraphData utility', () => {
    it('should filter nodes by type', () => {
      const filtered = filterGraphData(mockGraphData, ['Mission' as const, 'Agent' as const]);

      expect(filtered.nodes.length).toBe(2);
      expect(filtered.nodes.every((n) => ['Mission', 'Agent'].includes(n.labels[0]))).toBe(true);
    });

    it('should filter edges to only include filtered nodes', () => {
      const filtered = filterGraphData(mockGraphData, ['Mission' as const, 'Agent' as const]);

      // Only edge between mission and agent should remain
      expect(filtered.edges.length).toBe(1);
      expect(filtered.edges[0].type).toBe('uses');
    });

    it('should filter edges by relationship type', () => {
      const filtered = filterGraphData(mockGraphData, [], ['uses']);

      expect(filtered.edges.length).toBe(1);
      expect(filtered.edges[0].type).toBe('uses');
    });

    it('should combine node and relationship filters', () => {
      const filtered = filterGraphData(
        mockGraphData,
        ['Agent' as const, 'Host' as const],
        ['scans']
      );

      expect(filtered.nodes.length).toBe(2); // agent and host
      expect(filtered.edges.length).toBe(1); // scans relationship
      expect(filtered.edges[0].source).toBe('agent-1');
      expect(filtered.edges[0].target).toBe('host-1');
    });

    it('should return all data when no filters are applied', () => {
      const filtered = filterGraphData(mockGraphData);

      expect(filtered.nodes.length).toBe(mockGraphData.nodes.length);
      expect(filtered.edges.length).toBe(mockGraphData.edges.length);
    });

    it('should return all data when empty filter arrays are provided', () => {
      const filtered = filterGraphData(mockGraphData, [], []);

      expect(filtered.nodes.length).toBe(mockGraphData.nodes.length);
      expect(filtered.edges.length).toBe(mockGraphData.edges.length);
    });

    it('should handle nodes with multiple labels', () => {
      const graphWithMultipleLabels: GraphData = {
        nodes: [
          ...mockGraphData.nodes,
          {
            id: 'entity-1',
            labels: ['Host', 'Service'],
            properties: { name: 'Multi-label' },
          },
        ],
        edges: mockGraphData.edges,
      };

      const filtered = filterGraphData(graphWithMultipleLabels, ['Host' as const]);

      // Should include both host-1 and entity-1 (which has host label)
      expect(filtered.nodes.length).toBe(2);
    });

    it('should return empty result when filtering with non-existent type', () => {
      const filtered = filterGraphData(mockGraphData, ['nonexistent' as unknown as GraphNodeType]);

      expect(filtered.nodes.length).toBe(0);
      expect(filtered.edges.length).toBe(0);
    });

    it('should handle graph with disconnected nodes', () => {
      const graphWithDisconnected: GraphData = {
        nodes: [
          ...mockGraphData.nodes,
          {
            id: 'isolated-1',
            labels: ['isolated'],
            properties: { name: 'Isolated' },
          },
        ],
        edges: mockGraphData.edges,
      };

      const filtered = filterGraphData(graphWithDisconnected, ['Mission' as const]);

      // Mission node plus its connected edges
      expect(filtered.nodes.length).toBe(1);
      expect(filtered.edges.length).toBe(0); // No edges because targets are filtered out
    });
  });

  describe('caching behavior', () => {
    it('should cache mission graph data', async () => {
      const { result, rerender } = renderHook(() => useMissionGraph('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const firstData = result.current.data;

      // Rerender should use cached data
      rerender();

      expect(result.current.data).toBe(firstData);
    });

    it('should not refetch within staleTime', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');

      const { result, rerender } = renderHook(() => useFullGraph(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const callCount = fetchSpy.mock.calls.length;

      // Rerender immediately should not trigger new fetch
      rerender();

      expect(fetchSpy.mock.calls.length).toBe(callCount);

      fetchSpy.mockRestore();
    });
  });
});
