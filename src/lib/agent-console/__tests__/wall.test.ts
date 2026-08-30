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
  return { runId, agentName: runId, sandboxId: "", startedAt: "2026-08-30T10:00:00Z", ...over };
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
