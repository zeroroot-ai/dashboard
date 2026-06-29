/**
 * React Query hooks for knowledge graph data
 */

import { useQuery } from '@tanstack/react-query';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import type { GraphNodeType } from '@/src/types';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';

/**
 * Graph data response format
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Graph filter options
 */
interface GraphFilterOptions {
  /** Filter by node types */
  nodeTypes?: GraphNodeType[];
  /** Filter by relationship types */
  relationshipTypes?: string[];
  /** Search query */
  search?: string;
  /** Max number of nodes */
  limit?: number;
}

/**
 * Graph statistics
 */
interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  relationshipTypes: Record<string, number>;
}

/**
 * Fetch mission graph from API
 */
async function fetchMissionGraph(missionId: string): Promise<GraphData> {
  const response = await fetch(`/api/graph/mission/${missionId}`);

  if (!response.ok) {
    throw new Error('Failed to fetch mission graph');
  }

  return response.json();
}

/**
 * Fetch full graph from API with optional filters
 */
async function fetchFullGraph(
  filters: GraphFilterOptions = {}
): Promise<GraphData> {
  const params = new URLSearchParams();

  if (filters.nodeTypes?.length) {
    params.append('nodeTypes', filters.nodeTypes.join(','));
  }

  if (filters.relationshipTypes?.length) {
    params.append('relationshipTypes', filters.relationshipTypes.join(','));
  }

  if (filters.search) {
    params.append('search', filters.search);
  }

  if (filters.limit) {
    params.append('limit', filters.limit.toString());
  }

  const url = `/api/graph${params.toString() ? `?${params}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('Failed to fetch graph');
  }

  return response.json();
}

/**
 * Fetch graph statistics from API
 */
async function fetchGraphStats(): Promise<GraphStats> {
  const response = await fetch('/api/graph/stats');

  if (!response.ok) {
    throw new Error('Failed to fetch graph stats');
  }

  return response.json();
}

/**
 * Hook to fetch graph for a specific mission
 *
 * @param missionId - Mission identifier
 * @returns Query result with graph data
 */
export function useMissionGraph(missionId: string | null | undefined) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.graph.mission(tenantId, missionId || ''),
    queryFn: () => fetchMissionGraph(missionId!),
    enabled: !!missionId,
    staleTime: 2 * 60 * 1000, // 2 minutes (expensive query)
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch full knowledge graph with optional filters
 *
 * @param filters - Filter options
 * @returns Query result with graph data
 */
export function useFullGraph(filters: GraphFilterOptions = {}) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.graph.filtered(tenantId, filters),
    queryFn: () => fetchFullGraph(filters),
    staleTime: 2 * 60 * 1000, // 2 minutes (expensive query)
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch graph statistics
 *
 * @returns Query result with graph stats
 */
export function useGraphStats() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.graph.stats(tenantId),
    queryFn: fetchGraphStats,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch graph data (mission-scoped or full)
 *
 * Convenience hook that switches between mission and full graph
 * based on whether a mission ID is provided.
 *
 * @param missionId - Optional mission ID to scope graph
 * @param filters - Filter options for full graph
 * @returns Query result with graph data
 */
export function useGraph(
  missionId: string | null | undefined,
  filters?: GraphFilterOptions
) {
  const missionGraphQuery = useMissionGraph(missionId);
  const fullGraphQuery = useFullGraph(filters);

  // Return mission graph if mission ID provided, otherwise full graph
  return missionId ? missionGraphQuery : fullGraphQuery;
}

/**
 * Extract unique relationship types from graph data
 *
 * Utility function to get all available relationship types
 * from the current graph data for filtering UI.
 *
 * @param data - Graph data
 * @returns Array of unique relationship types
 */
export function extractRelationshipTypes(data?: GraphData): string[] {
  if (!data?.edges) {
    return [];
  }

  const types = new Set<string>();
  data.edges.forEach((edge) => types.add(edge.type));
  return Array.from(types).sort();
}

/**
 * Filter graph data by node and relationship types
 *
 * Client-side filtering utility for graph data.
 * Used when you want to filter without refetching from API.
 *
 * @param data - Graph data to filter
 * @param nodeTypes - Node types to include (empty = all)
 * @param relationshipTypes - Relationship types to include (empty = all)
 * @returns Filtered graph data
 */
export function filterGraphData(
  data: GraphData,
  nodeTypes: GraphNodeType[] = [],
  relationshipTypes: string[] = []
): GraphData {
  // Filter nodes by type
  let filteredNodes = data.nodes;
  if (nodeTypes.length > 0) {
    filteredNodes = data.nodes.filter((node) =>
      node.labels.some((label) => nodeTypes.includes(label as GraphNodeType))
    );
  }

  const nodeIds = new Set(filteredNodes.map((n) => n.id));

  // Filter edges: must connect filtered nodes and match relationship type filter
  let filteredEdges = data.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );

  if (relationshipTypes.length > 0) {
    filteredEdges = filteredEdges.filter((edge) =>
      relationshipTypes.includes(edge.type)
    );
  }

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
  };
}
