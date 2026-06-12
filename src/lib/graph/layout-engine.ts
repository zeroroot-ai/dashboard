/**
 * Graph layout engine (pure).
 *
 * Computes deterministic node positions for the non-force layout modes used by
 * the knowledge-graph explorer. Lives under `src/lib/` so it can be unit-tested
 * in isolation from the canvas, given the same nodes/edges/mode it always
 * returns the same positions (no randomness, no time, no DOM).
 *
 * `force` returns `null`, meaning "let the rendering engine's force simulation
 * place the nodes" (the canvas unpins nodes in that case). The other three
 * modes return a fixed position per node id, which the canvas pins via fx/fy.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';
import type { GraphLayoutMode } from '@/src/stores/graph-view-store';

export interface Point {
  x: number;
  y: number;
}

/** A fixed position per node id, or null to defer to the force simulation. */
export type LayoutPositions = Map<string, Point> | null;

// Spacing constants (graph-space units; the canvas zoom-fits afterward).
const HIER_X_GAP = 90;
const HIER_Y_GAP = 130;
const RADIAL_RING = 170;
const TIMELINE_X_GAP = 90;
const TIMELINE_LANES = 7;
const TIMELINE_LANE_GAP = 46;

/**
 * Extract a comparable timestamp (epoch ms) from a node's properties, or null
 * when none is present. Recognizes the common discovery/creation fields.
 */
export function getNodeTimestamp(node: GraphNode): number | null {
  const p = node.properties ?? {};
  const candidates = [
    p.createdAt, p.created_at, p.addedAt, p.added_at,
    p.startedAt, p.started_at, p.timestamp, p.time,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (c instanceof Date) return c.getTime();
    if (typeof c === 'string') {
      const t = Date.parse(c);
      if (!Number.isNaN(t)) return t;
    }
  }
  return null;
}

/**
 * Assign a depth to every node: roots (no incoming edges) are depth 0, and each
 * node's depth is the longest path from a root (Kahn topological pass). Nodes
 * only reachable through cycles fall back to depth 0. Deterministic.
 */
export function computeDepths(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const adj = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    adj.set(id, []);
    indeg.set(id, 0);
  }
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
    adj.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  const depth = new Map<string, number>();
  const remaining = new Map(indeg);
  // Seed roots (indegree 0) at depth 0, in deterministic id order.
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  for (const id of queue) depth.set(id, 0);

  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id) ?? 0;
    for (const child of adj.get(id)!) {
      depth.set(child, Math.max(depth.get(child) ?? 0, d + 1));
      const rem = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, rem);
      if (rem === 0) queue.push(child);
    }
  }

  // Any node never assigned (reachable only via a cycle) → depth 0.
  for (const id of ids) if (!depth.has(id)) depth.set(id, 0);
  return depth;
}

/** Group node ids by depth, each group sorted by id for stable ordering. */
function levelsByDepth(depths: Map<string, number>): Map<number, string[]> {
  const levels = new Map<number, string[]>();
  for (const [id, d] of depths) {
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d)!.push(id);
  }
  for (const arr of levels.values()) arr.sort();
  return levels;
}

function hierarchyLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
  const depths = computeDepths(nodes, edges);
  const levels = levelsByDepth(depths);
  const pos = new Map<string, Point>();
  for (const [d, idsAtLevel] of levels) {
    const n = idsAtLevel.length;
    idsAtLevel.forEach((id, i) => {
      pos.set(id, { x: (i - (n - 1) / 2) * HIER_X_GAP, y: d * HIER_Y_GAP });
    });
  }
  return pos;
}

function radialLayout(nodes: GraphNode[], edges: GraphEdge[]): Map<string, Point> {
  const depths = computeDepths(nodes, edges);
  const levels = levelsByDepth(depths);
  const pos = new Map<string, Point>();
  for (const [d, idsAtLevel] of levels) {
    const n = idsAtLevel.length;
    if (d === 0 && n === 1) {
      pos.set(idsAtLevel[0], { x: 0, y: 0 });
      continue;
    }
    const r = d === 0 ? RADIAL_RING * 0.4 : d * RADIAL_RING;
    idsAtLevel.forEach((id, i) => {
      const angle = (2 * Math.PI * i) / n;
      pos.set(id, { x: r * Math.cos(angle), y: r * Math.sin(angle) });
    });
  }
  return pos;
}

function timelineLayout(nodes: GraphNode[]): Map<string, Point> {
  const ordered = [...nodes].sort((a, b) => {
    const ta = getNodeTimestamp(a);
    const tb = getNodeTimestamp(b);
    const va = ta ?? Number.POSITIVE_INFINITY;
    const vb = tb ?? Number.POSITIVE_INFINITY;
    if (va !== vb) return va - vb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const pos = new Map<string, Point>();
  ordered.forEach((node, i) => {
    const lane = (i % TIMELINE_LANES) - (TIMELINE_LANES - 1) / 2;
    pos.set(node.id, { x: i * TIMELINE_X_GAP, y: lane * TIMELINE_LANE_GAP });
  });
  return pos;
}

/**
 * Compute fixed positions for the given layout mode, or null for `force`
 * (defer to the rendering engine's force simulation).
 */
export function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: GraphLayoutMode
): LayoutPositions {
  switch (mode) {
    case 'hierarchy':
      return hierarchyLayout(nodes, edges);
    case 'radial':
      return radialLayout(nodes, edges);
    case 'timeline':
      return timelineLayout(nodes);
    case 'force':
    default:
      return null;
  }
}
