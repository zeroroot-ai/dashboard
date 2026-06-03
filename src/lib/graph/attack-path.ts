/**
 * Attack-path emphasis (pure).
 *
 * Derives the set of offensive-relationship edges (exploit / leads-to /
 * affects / technique chains) and their endpoint nodes, so the canvas can
 * highlight the kill chain and dim everything else — reusing the same highlight
 * mechanism as a path query. Lives under `src/lib/` for unit testing.
 */

import type { GraphEdge } from '@/src/types/graph';

/** Relationship types that constitute an attack path. */
export const ATTACK_RELATIONSHIPS = new Set<string>([
  'EXPLOITS',
  'LEADS_TO',
  'AFFECTS',
  'USES_TECHNIQUE',
]);

export interface HighlightSets {
  node_ids: string[];
  edge_ids: string[];
}

/**
 * Edges whose type is an attack relationship, plus their endpoint node ids.
 * Returns empty sets when there are no attack edges.
 */
export function attackPathSets(edges: GraphEdge[]): HighlightSets {
  const nodeIds = new Set<string>();
  const edgeIds: string[] = [];
  for (const e of edges) {
    if (ATTACK_RELATIONSHIPS.has(e.type)) {
      edgeIds.push(e.id);
      nodeIds.add(e.source);
      nodeIds.add(e.target);
    }
  }
  return { node_ids: [...nodeIds], edge_ids: edgeIds };
}
