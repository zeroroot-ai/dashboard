/**
 * Timeline scrubber helpers (pure).
 *
 * Reveal the graph as it grew over a mission run by filtering to nodes
 * discovered up to a cutoff time. Reuses the node-timestamp parsing from the
 * layout engine. Lives under `src/lib/` for unit testing.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { getNodeTimestamp } from '@/src/lib/graph/layout-engine';

export interface TimelineBounds {
  min: number;
  max: number;
}

/** Min/max node timestamp across the graph, or null when none carry one. */
export function timelineBounds(nodes: GraphNode[]): TimelineBounds | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;
  for (const n of nodes) {
    const ts = getNodeTimestamp(n);
    if (ts != null) {
      found = true;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
    }
  }
  return found ? { min, max } : null;
}

/**
 * The graph as it existed up to `cutoff` (epoch ms): nodes whose timestamp is
 * ≤ cutoff, plus timeless nodes (structural anchors are always present), and
 * edges between visible nodes. Pure.
 */
export function filterByTime(
  nodes: GraphNode[],
  edges: GraphEdge[],
  cutoff: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const visible = new Set<string>();
  for (const n of nodes) {
    const ts = getNodeTimestamp(n);
    if (ts == null || ts <= cutoff) visible.add(n.id);
  }
  return {
    nodes: nodes.filter((n) => visible.has(n.id)),
    edges: edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
  };
}
