import { describe, it, expect } from "vitest";

import {
  applyNodeEvent,
  newAccumulator,
  toRunSignals,
  type NodeEvent,
} from "../run-signals";

/** Fold a sequence of events and snapshot the result. */
function fold(events: NodeEvent[]) {
  const acc = newAccumulator();
  for (const e of events) applyNodeEvent(acc, e);
  return toRunSignals(acc);
}

describe("run-signals accumulator", () => {
  it("starts empty", () => {
    expect(toRunSignals(newAccumulator())).toEqual({
      completedNodeIds: [],
      currentNodeId: null,
      failedNodeId: null,
    });
  });

  it("marks a started node as current", () => {
    const s = fold([{ nodeId: "a", phase: "started" }]);
    expect(s.currentNodeId).toBe("a");
    expect(s.completedNodeIds).toEqual([]);
  });

  it("moves a node from current to completed and clears current", () => {
    const s = fold([
      { nodeId: "a", phase: "started" },
      { nodeId: "a", phase: "completed" },
    ]);
    expect(s.completedNodeIds).toEqual(["a"]);
    expect(s.currentNodeId).toBeNull();
  });

  it("tracks the latest running node across a sequence", () => {
    const s = fold([
      { nodeId: "a", phase: "started" },
      { nodeId: "a", phase: "completed" },
      { nodeId: "b", phase: "started" },
    ]);
    expect(s.completedNodeIds).toEqual(["a"]);
    expect(s.currentNodeId).toBe("b");
  });

  it("records a failed node and clears it from current", () => {
    const s = fold([
      { nodeId: "a", phase: "started" },
      { nodeId: "a", phase: "failed" },
    ]);
    expect(s.failedNodeId).toBe("a");
    expect(s.currentNodeId).toBeNull();
    expect(s.completedNodeIds).toEqual([]);
  });

  it("collapses duplicate completed frames", () => {
    const s = fold([
      { nodeId: "a", phase: "completed" },
      { nodeId: "a", phase: "completed" },
    ]);
    expect(s.completedNodeIds).toEqual(["a"]);
  });

  it("ignores events with an empty node id", () => {
    const s = fold([
      { nodeId: "", phase: "started" },
      { nodeId: "", phase: "completed" },
    ]);
    expect(s).toEqual({
      completedNodeIds: [],
      currentNodeId: null,
      failedNodeId: null,
    });
  });

  it("does not clear current when a different node completes", () => {
    const s = fold([
      { nodeId: "a", phase: "started" },
      { nodeId: "b", phase: "completed" },
    ]);
    expect(s.currentNodeId).toBe("a");
    expect(s.completedNodeIds).toEqual(["b"]);
  });
});
