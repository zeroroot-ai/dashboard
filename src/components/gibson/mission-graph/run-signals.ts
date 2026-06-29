/**
 * run-signals.ts, pure accumulation of a mission run's live node-lifecycle
 * events into the {@link RunSignals} shape that {@link deriveOverlay} consumes.
 *
 * The daemon streams per-node `started` / `completed` / `failed` events as a
 * run progresses (gibson#604). MissionFlowTab folds each event into an
 * accumulator with this module, then snapshots it to RunSignals and hands it to
 * the (already-tested) overlay derivation. Kept free of React so the folding
 * rules are unit-testable in isolation, there is NO derivation logic here, only
 * accumulation.
 *
 * Spec: MissionGraph epic, dashboard#657 (overlay) / gibson#604 (live events).
 */

import type { RunSignals } from "./overlay";

export type NodePhase = "started" | "completed" | "failed";

/** One node lifecycle transition, as forwarded by the SSE `node` frame. */
export interface NodeEvent {
  nodeId: string;
  phase: NodePhase;
}

/**
 * Mutable accumulator the live stream folds node events into. Uses a Set for
 * completed ids so duplicate `completed` frames (a re-delivered Redis Stream
 * entry, a retried node) collapse naturally.
 */
interface RunSignalAccumulator {
  completed: Set<string>;
  current: string | null;
  failed: string | null;
}

export function newAccumulator(): RunSignalAccumulator {
  return { completed: new Set<string>(), current: null, failed: null };
}

/**
 * Fold one node lifecycle event into the accumulator in place, returning the
 * same accumulator for chaining. Empty node ids are ignored. The currently
 * executing node is cleared once it completes or fails so a finished node never
 * lingers as "running".
 */
export function applyNodeEvent(
  acc: RunSignalAccumulator,
  ev: NodeEvent,
): RunSignalAccumulator {
  if (!ev.nodeId) return acc;
  switch (ev.phase) {
    case "started":
      acc.current = ev.nodeId;
      break;
    case "completed":
      acc.completed.add(ev.nodeId);
      if (acc.current === ev.nodeId) acc.current = null;
      break;
    case "failed":
      acc.failed = ev.nodeId;
      if (acc.current === ev.nodeId) acc.current = null;
      break;
  }
  return acc;
}

/** Snapshot the accumulator as the immutable RunSignals deriveOverlay expects. */
export function toRunSignals(acc: RunSignalAccumulator): RunSignals {
  return {
    completedNodeIds: [...acc.completed],
    currentNodeId: acc.current,
    failedNodeId: acc.failed,
  };
}
