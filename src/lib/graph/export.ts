/**
 * Graph export (pure).
 *
 * Serializes the currently-visible graph (after filters + node-ops) to a plain
 * JSON-ready object. Lives under `src/lib/` for unit testing; the page handles
 * the actual file download.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';

export interface GraphExportNode {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
}

export interface GraphExportEdge {
  id: string;
  type: string;
  source: string;
  target: string;
  properties: Record<string, unknown>;
}

export interface GraphExport {
  exportedAt: string;
  nodeCount: number;
  edgeCount: number;
  nodes: GraphExportNode[];
  edges: GraphExportEdge[];
}

/**
 * Build the export payload for the given (already-visible) nodes/edges.
 * `at` is injectable for deterministic tests.
 */
export function toGraphExportJSON(
  nodes: GraphNode[],
  edges: GraphEdge[],
  at: string = new Date().toISOString()
): GraphExport {
  return {
    exportedAt: at,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    nodes: nodes.map((n) => ({
      id: n.id,
      labels: n.labels ?? [],
      properties: n.properties ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source,
      target: e.target,
      properties: e.properties ?? {},
    })),
  };
}
