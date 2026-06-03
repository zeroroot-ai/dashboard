/**
 * Graph filtering (pure).
 *
 * One filter contract, applied client-side to the fetched graph before it
 * reaches the canvas and the side panels. Lives under `src/lib/` so it is
 * unit-testable in isolation. The daemon's graph endpoint only supports a row
 * limit (no server-side type/severity filtering), so filtering happens here.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';
import { parseEntityType } from '@/src/lib/graph/entity-taxonomy';

export type SeverityFloor = 'all' | 'info' | 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** Entity types treated as roots for the depth filter. */
const ROOT_TYPES = new Set(['mission', 'mission_run']);

export interface GraphFilterState {
  /** Entity types to hide (empty = show all). Keyed by parsed entity type. */
  hiddenNodeTypes: string[];
  /** Relationship (edge) types to hide (empty = show all). */
  hiddenRelationshipTypes: string[];
  /** Minimum finding severity to show; 'all' shows every severity. */
  severityFloor: SeverityFloor;
  /** Max hops from root nodes; 0 = unlimited. */
  depth: number;
}

export const DEFAULT_GRAPH_FILTERS: GraphFilterState = {
  hiddenNodeTypes: [],
  hiddenRelationshipTypes: [],
  severityFloor: 'all',
  depth: 0,
};

/** Parsed entity type of a node (e.g. 'host', 'finding', 'mission'). */
export function nodeType(node: GraphNode): string {
  return parseEntityType(node.labels);
}

/** Unique entity types present in the data, sorted. */
export function availableNodeTypes(nodes: GraphNode[]): string[] {
  return Array.from(new Set(nodes.map(nodeType))).sort();
}

/** Unique relationship types present in the data, sorted. */
export function availableRelationshipTypes(edges: GraphEdge[]): string[] {
  return Array.from(new Set(edges.map((e) => e.type))).sort();
}

function passesSeverity(node: GraphNode, floor: SeverityFloor): boolean {
  if (floor === 'all') return true;
  // Severity only gates finding nodes; everything else is unaffected.
  if (nodeType(node) !== 'finding') return true;
  const sev = String(node.properties?.severity ?? '').toLowerCase();
  const rank = SEVERITY_RANK[sev];
  if (rank === undefined) return false; // a finding with no/unknown severity
  return rank >= SEVERITY_RANK[floor];
}

/**
 * Apply the filter contract to a graph, returning the visible subset.
 * Pure: same input → same output.
 */
export function applyGraphFilters(
  nodes: GraphNode[],
  edges: GraphEdge[],
  filters: GraphFilterState
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const hiddenTypes = new Set(filters.hiddenNodeTypes);
  const hiddenRels = new Set(filters.hiddenRelationshipTypes);

  // 1. Node type + severity gate.
  const kept = new Set<string>();
  for (const n of nodes) {
    if (hiddenTypes.has(nodeType(n))) continue;
    if (!passesSeverity(n, filters.severityFloor)) continue;
    kept.add(n.id);
  }

  // 2. Edges between kept nodes whose relationship type is not hidden.
  const visibleEdges = edges.filter(
    (e) => kept.has(e.source) && kept.has(e.target) && !hiddenRels.has(e.type)
  );

  // 3. Depth gate: keep nodes within `depth` undirected hops of a root.
  let finalKept = kept;
  if (filters.depth > 0 && kept.size > 0) {
    const adj = new Map<string, string[]>();
    for (const id of kept) adj.set(id, []);
    for (const e of visibleEdges) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    let roots = [...kept].filter((id) => {
      const n = nodeById.get(id);
      return n ? ROOT_TYPES.has(nodeType(n)) : false;
    });
    // No explicit roots → use nodes with no incoming visible edge.
    if (roots.length === 0) {
      const hasIncoming = new Set(visibleEdges.map((e) => e.target));
      roots = [...kept].filter((id) => !hasIncoming.has(id));
    }
    // Still none (e.g. a pure cycle) → depth can't be anchored; keep all.
    if (roots.length > 0) {
      const dist = new Map<string, number>();
      const queue: string[] = [];
      for (const r of roots.sort()) {
        dist.set(r, 0);
        queue.push(r);
      }
      while (queue.length) {
        const id = queue.shift()!;
        const d = dist.get(id)!;
        if (d >= filters.depth) continue;
        for (const nb of adj.get(id) ?? []) {
          if (!dist.has(nb)) {
            dist.set(nb, d + 1);
            queue.push(nb);
          }
        }
      }
      finalKept = new Set(dist.keys());
    }
  }

  const outNodes = nodes.filter((n) => finalKept.has(n.id));
  const outEdges = visibleEdges.filter((e) => finalKept.has(e.source) && finalKept.has(e.target));
  return { nodes: outNodes, edges: outEdges };
}
