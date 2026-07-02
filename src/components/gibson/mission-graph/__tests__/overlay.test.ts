import { describe, it, expect } from "vitest";

import type { MissionGraphData } from "@/app/actions/missions/mission-graph";
import { deriveOverlay, edgeKey } from "../overlay";

function graph(
  nodes: string[],
  edges: { from: string; to: string; role?: string }[],
): MissionGraphData {
  return {
    nodes: nodes.map((id, i) => ({
      id,
      kind: "agent",
      name: id,
      summary: "",
      isEntry: i === 0,
      isExit: false,
      rank: i,
      x: 0,
      y: 0,
      layoutSource: "auto",
    })),
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      condition: "",
      role: e.role ?? "",
    })),
    entryPoints: [nodes[0]],
    exitPoints: [],
    viewport: null,
  };
}

describe("deriveOverlay", () => {
  it("with no run signals, everything is pending / not-reached", () => {
    const g = graph(["a", "b"], [{ from: "a", to: "b" }]);
    const o = deriveOverlay(g, { completedNodeIds: [] });
    expect(o.nodeStates).toEqual({ a: "pending", b: "pending" });
    expect(o.edgeStates[edgeKey("a", "b")]).toBe("not-reached");
  });

  it("marks completed, running, failed nodes", () => {
    const g = graph(["a", "b", "c"], [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ]);
    const o = deriveOverlay(g, {
      completedNodeIds: ["a"],
      currentNodeId: "b",
      failedNodeId: "c",
    });
    expect(o.nodeStates).toEqual({ a: "completed", b: "running", c: "failed" });
  });

  it("traverses an edge once source completed and target entered", () => {
    const g = graph(["a", "b"], [{ from: "a", to: "b" }]);
    const running = deriveOverlay(g, {
      completedNodeIds: ["a"],
      currentNodeId: "b",
    });
    expect(running.edgeStates[edgeKey("a", "b")]).toBe("traversed");

    const done = deriveOverlay(g, { completedNodeIds: ["a", "b"] });
    expect(done.edgeStates[edgeKey("a", "b")]).toBe("traversed");
  });

  it("distinguishes routed-around from not-reached on condition branches", () => {
    // check --true--> exploit ; check --false--> report
    const g = graph(
      ["check", "exploit", "report"],
      [
        { from: "check", to: "exploit", role: "true" },
        { from: "check", to: "report", role: "false" },
      ],
    );
    // condition completed, the true branch was taken (exploit entered).
    const o = deriveOverlay(g, { completedNodeIds: ["check", "exploit"] });
    expect(o.edgeStates[edgeKey("check", "exploit")]).toBe("traversed");
    expect(o.edgeStates[edgeKey("check", "report")]).toBe("routed-around");
  });

  it("a branch whose source has not completed is just not-reached", () => {
    const g = graph(
      ["check", "exploit", "report"],
      [
        { from: "check", to: "exploit", role: "true" },
        { from: "check", to: "report", role: "false" },
      ],
    );
    const o = deriveOverlay(g, { completedNodeIds: [], currentNodeId: "check" });
    expect(o.edgeStates[edgeKey("check", "exploit")]).toBe("not-reached");
    expect(o.edgeStates[edgeKey("check", "report")]).toBe("not-reached");
  });
});
