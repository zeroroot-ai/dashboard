/**
 * Live-run helpers (pure).
 *
 * Identify "running" nodes and the edges touching them so the canvas can pulse
 * active nodes and flow particles along active edges during a live mission run.
 * Lives under `src/lib/` for unit testing.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';

/** A node is live when its status property is "running". */
export function isRunning(node: GraphNode): boolean {
  return String(node.properties?.status ?? '').toLowerCase() === 'running';
}

/** Ids of all running nodes. */
export function runningNodeIds(nodes: GraphNode[]): Set<string> {
  return new Set(nodes.filter(isRunning).map((n) => n.id));
}

/** An edge is live when either endpoint is a running node. */
export function edgeIsLive(edge: GraphEdge, running: Set<string>): boolean {
  return running.has(edge.source) || running.has(edge.target);
}
