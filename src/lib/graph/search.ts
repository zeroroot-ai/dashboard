/**
 * Graph node search (pure).
 *
 * Substring matching over node display names (and ids) for the search-to-focus
 * box. Lives under `src/lib/` so it is unit-testable without the canvas.
 */

import type { GraphNode } from '@/src/types/graph';

/** Human-facing name for a node: its `name` property, else its id. */
export function getNodeDisplayName(node: GraphNode): string {
  const name = node.properties?.name;
  if (typeof name === 'string' && name.length > 0) return name;
  return node.id;
}

/**
 * Return nodes matching `query` (case-insensitive substring of name or id),
 * ranked by match position (prefix/earlier first) then shorter name. Empty
 * query returns no results.
 */
export function matchNodes(nodes: GraphNode[], query: string, limit = 12): GraphNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { node: GraphNode; rank: number; len: number }[] = [];
  for (const node of nodes) {
    const name = getNodeDisplayName(node).toLowerCase();
    const idx = name.indexOf(q);
    if (idx >= 0) {
      scored.push({ node, rank: idx, len: name.length });
    } else if (node.id.toLowerCase().includes(q)) {
      scored.push({ node, rank: 1000, len: node.id.length });
    }
  }
  scored.sort((a, b) => a.rank - b.rank || a.len - b.len);
  return scored.slice(0, limit).map((s) => s.node);
}
