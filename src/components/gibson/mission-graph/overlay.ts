/**
 * overlay.ts — pure derivation of run-execution visual state for the
 * MissionGraph flow-chart. Given the static graph plus the signals a mission
 * run already emits (completed node ids, the currently-executing node, a failed
 * node, overall status), it computes per-node and per-edge visual state.
 *
 * Kept free of React so it is unit-testable in isolation. Spec: dashboard#657.
 */

import type {
  MissionGraphData,
  MissionGraphEdgeData,
} from "@/app/actions/missions/mission-graph";

export type NodeRunState = "pending" | "running" | "completed" | "failed";

/**
 * - "traversed": the edge carried data (source completed, target entered).
 * - "routed-around": a condition branch the run did not take (a sibling branch
 *   was taken instead).
 * - "not-reached": the run has not progressed to this edge yet.
 */
export type EdgeRunState = "traversed" | "routed-around" | "not-reached";

export interface RunSignals {
  /** Node ids the run has completed. */
  completedNodeIds: string[];
  /** The node currently executing, if any. */
  currentNodeId?: string | null;
  /** A node that failed, if any. */
  failedNodeId?: string | null;
}

export interface RunOverlay {
  nodeStates: Record<string, NodeRunState>;
  /** Keyed by edgeKey(from, to). */
  edgeStates: Record<string, EdgeRunState>;
}

export function edgeKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function entered(
  nodeId: string,
  completed: Set<string>,
  currentNodeId?: string | null,
): boolean {
  return completed.has(nodeId) || nodeId === currentNodeId;
}

/**
 * deriveOverlay computes the visual run state for every node and edge. With no
 * run signals (empty completed set, no current/failed node) every node is
 * pending and every edge not-reached — the static authoring view.
 */
export function deriveOverlay(
  graph: MissionGraphData,
  signals: RunSignals,
): RunOverlay {
  const completed = new Set(signals.completedNodeIds);
  const current = signals.currentNodeId ?? null;
  const failed = signals.failedNodeId ?? null;

  const nodeStates: Record<string, NodeRunState> = {};
  for (const n of graph.nodes) {
    if (n.id === failed) nodeStates[n.id] = "failed";
    else if (completed.has(n.id)) nodeStates[n.id] = "completed";
    else if (n.id === current) nodeStates[n.id] = "running";
    else nodeStates[n.id] = "pending";
  }

  // Index sibling branch targets per condition source so "routed-around" can be
  // distinguished from "not-reached".
  const siblingsEntered = new Map<string, boolean>(); // from -> any branch entered
  for (const e of graph.edges) {
    if (e.role === "true" || e.role === "false") {
      const was = siblingsEntered.get(e.from) ?? false;
      siblingsEntered.set(
        e.from,
        was || entered(e.to, completed, current),
      );
    }
  }

  const edgeStates: Record<string, EdgeRunState> = {};
  for (const e of graph.edges) {
    edgeStates[edgeKey(e.from, e.to)] = classifyEdge(
      e,
      completed,
      current,
      siblingsEntered,
    );
  }

  return { nodeStates, edgeStates };
}

function classifyEdge(
  e: MissionGraphEdgeData,
  completed: Set<string>,
  current: string | null,
  siblingsEntered: Map<string, boolean>,
): EdgeRunState {
  const sourceDone = completed.has(e.from);
  if (sourceDone && entered(e.to, completed, current)) {
    return "traversed";
  }
  // A condition branch whose source completed but whose target was not entered,
  // while a sibling branch WAS entered, is a path the run routed around.
  const isBranch = e.role === "true" || e.role === "false";
  if (isBranch && sourceDone && siblingsEntered.get(e.from)) {
    return "routed-around";
  }
  return "not-reached";
}
