/**
 * Node manipulation (pure).
 *
 * Hide / isolate-and-expand operations over a graph, plus the neighborhood
 * helper they share. Pinning is a render-only concern (handled by the canvas
 * via fx/fy) and is not modeled here. Lives under `src/lib/` for unit testing.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';

/**
 * Undirected BFS neighborhood of `rootId` up to `depth` hops (inclusive of the
 * root). depth 0 → just the root; depth 1 → root + direct neighbors; etc.
 */
export function neighborhood(edges: GraphEdge[], rootId: string, depth: number): Set<string> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };
  for (const e of edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return seen;
}

export interface NodeOpsState {
  /** Node ids the user has hidden. */
  hiddenNodeIds: string[];
  /** When set, only this node + its `focusDepth`-hop neighborhood is shown. */
  focusNodeId: string | null;
  /** Hops from the focus node to keep when isolating (>= 1). */
  focusDepth: number;
}

export const DEFAULT_NODE_OPS: NodeOpsState = {
  hiddenNodeIds: [],
  focusNodeId: null,
  focusDepth: 1,
};

/**
 * Apply hide + isolate/expand to a graph, returning the visible subset.
 * Hidden nodes (and their incident edges) are removed first; if a focus node is
 * set and still visible, only its neighborhood within `focusDepth` remains.
 * Pure: same input → same output.
 */
export function applyNodeOps(
  nodes: GraphNode[],
  edges: GraphEdge[],
  ops: NodeOpsState
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const hidden = new Set(ops.hiddenNodeIds);
  let keptNodes = nodes.filter((n) => !hidden.has(n.id));
  let keptEdges = edges.filter((e) => !hidden.has(e.source) && !hidden.has(e.target));

  if (ops.focusNodeId && keptNodes.some((n) => n.id === ops.focusNodeId)) {
    const inFocus = neighborhood(keptEdges, ops.focusNodeId, Math.max(1, ops.focusDepth));
    keptNodes = keptNodes.filter((n) => inFocus.has(n.id));
    keptEdges = keptEdges.filter((e) => inFocus.has(e.source) && inFocus.has(e.target));
  }

  return { nodes: keptNodes, edges: keptEdges };
}
