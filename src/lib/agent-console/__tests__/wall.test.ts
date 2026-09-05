/** Ops wall layout tests (dashboard#1146). */
import { describe, it, expect } from "vitest";
import {
  wallColumns,
  tileHeight,
  tileFontSize,
  sortRunning,
  pickChoice,
} from "../wall";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

function agent(runId: string, over: Partial<RunningAgentView> = {}): RunningAgentView {
  return { runId, agentName: runId, sandboxId: "", startedAt: "2026-08-30T10:00:00Z", missionId: "", missionRunId: "", sandboxClass: "agent", componentKind: "agent", ...over };
}

describe("wallColumns", () => {
  it("fits 1, 4, 12 and 25 agents into 1, 2, 3 and 5 columns", () => {
    expect(wallColumns(0)).toBe(1);
    expect(wallColumns(1)).toBe(1);
    expect(wallColumns(2)).toBe(2);
    expect(wallColumns(4)).toBe(2);
    expect(wallColumns(5)).toBe(3);
    expect(wallColumns(9)).toBe(3);
    expect(wallColumns(10)).toBe(5);
    expect(wallColumns(12)).toBe(5);
    expect(wallColumns(25)).toBe(5);
  });

  it("goes to six columns above 25", () => {
    expect(wallColumns(26)).toBe(6);
    expect(wallColumns(100)).toBe(6);
  });
});

describe("tileHeight and tileFontSize", () => {
  it("shrinks with more columns and with compact density", () => {
    const cols = [1, 2, 3, 5, 6];
    for (let i = 1; i < cols.length; i++) {
      expect(tileHeight(cols[i], "comfortable")).toBeLessThan(tileHeight(cols[i - 1], "comfortable"));
      expect(tileHeight(cols[i], "compact")).toBeLessThan(tileHeight(cols[i], "comfortable"));
    }
    expect(tileHeight(99, "compact")).toBe(tileHeight(6, "compact"));
    expect(tileFontSize("compact")).toBeLessThan(tileFontSize("comfortable"));
  });
});

describe("sortRunning", () => {
  const a = agent("r-a", { agentName: "zerocool", startedAt: "2026-08-30T10:02:00Z" });
  const b = agent("r-b", { agentName: "claude", startedAt: "2026-08-30T10:01:00Z" });
  const c = agent("r-c", { agentName: "claude", startedAt: "2026-08-30T10:03:00Z" });
  const facts = new Map([
    ["r-a", { costUsd: 0.5 }],
    ["r-c", { costUsd: 1.25 }],
  ]);

  it("puts the oldest run first for started", () => {
    expect(sortRunning([a, b, c], "started", facts).map((x) => x.runId)).toEqual(["r-b", "r-a", "r-c"]);
  });

  it("sorts by name with the run id as the tie-break", () => {
    expect(sortRunning([a, c, b], "name", facts).map((x) => x.runId)).toEqual(["r-b", "r-c", "r-a"]);
  });

  it("puts the most expensive run first and unknown costs last", () => {
    expect(sortRunning([a, b, c], "cost", facts).map((x) => x.runId)).toEqual(["r-c", "r-a", "r-b"]);
  });

  it("does not mutate the input", () => {
    const input = [a, b, c];
    sortRunning(input, "name", facts);
    expect(input.map((x) => x.runId)).toEqual(["r-a", "r-b", "r-c"]);
  });
});

describe("pickChoice", () => {
  it("accepts an allowed value and falls back otherwise", () => {
    expect(pickChoice("compact", ["comfortable", "compact"], "comfortable")).toBe("compact");
    expect(pickChoice("bogus", ["comfortable", "compact"], "comfortable")).toBe("comfortable");
    expect(pickChoice(null, ["a"], "a")).toBe("a");
  });
});

// ---------------------------------------------------------------------------
// Finished-run fold (dashboard#1145)
// ---------------------------------------------------------------------------

import { foldSeenRuns, splitWall, ribbonLabel, RIBBON_MS } from "../wall";

describe("foldSeenRuns and splitWall", () => {
  const a = agent("r-a");
  const b = agent("r-b");

  it("keeps identity when nothing changed and marks a run that left the list", () => {
    const empty = new Map();
    const s1 = foldSeenRuns(empty, [a, b], new Map(), 1000);
    expect(s1.size).toBe(2);
    expect(foldSeenRuns(s1, [a, b], new Map(), 2000)).toBe(s1);
    const s2 = foldSeenRuns(s1, [a], new Map(), 3000);
    expect(s2.get("r-b")).toEqual({ agent: b, endedAt: 3000, ended: undefined });
    expect(s2.get("r-a")).toEqual({ agent: a });
  });

  it("marks a run whose stream ended while still listed, once", () => {
    const facts = new Map([["r-a", { ended: "finished" as const }]]);
    const s1 = foldSeenRuns(new Map(), [a], facts, 1000);
    expect(s1.get("r-a")).toEqual({ agent: a, endedAt: 1000, ended: "finished" });
    expect(foldSeenRuns(s1, [a], facts, 5000)).toBe(s1);
  });

  it("fills in how a run ended when the fact arrives after it left the list", () => {
    const s1 = foldSeenRuns(new Map(), [a], new Map(), 1000);
    const s2 = foldSeenRuns(s1, [], new Map(), 2000);
    expect(s2.get("r-a")?.ended).toBeUndefined();
    const s3 = foldSeenRuns(s2, [], new Map([["r-a", { ended: "error" as const }]]), 3000);
    expect(s3.get("r-a")).toEqual({ agent: a, endedAt: 2000, ended: "error" });
  });

  it("keeps an ended run on the wall for the ribbon window, then lists it as recent", () => {
    const s1 = foldSeenRuns(new Map(), [a, b], new Map(), 0);
    const s2 = foldSeenRuns(s1, [a], new Map(), 1000);
    expect(splitWall(s2, 1000 + RIBBON_MS - 1).tiles.map((r) => r.agent.runId).sort()).toEqual(["r-a", "r-b"]);
    const late = splitWall(s2, 1000 + RIBBON_MS);
    expect(late.tiles.map((r) => r.agent.runId)).toEqual(["r-a"]);
    expect(late.recent.map((r) => r.agent.runId)).toEqual(["r-b"]);
  });

  it("labels ribbons by how the run ended", () => {
    expect(ribbonLabel("finished")).toBe("Completed");
    expect(ribbonLabel("error")).toBe("Failed");
    expect(ribbonLabel("gone")).toBe("Stopped");
    expect(ribbonLabel(undefined)).toBe("Stopped");
  });
});
