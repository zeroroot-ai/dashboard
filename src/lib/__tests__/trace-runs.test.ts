import { describe, it, expect } from "vitest";
import { groupTracesIntoRuns } from "@/src/lib/trace-runs";
import type { TraceSummary } from "@/src/types/trace";

function trace(over: Partial<TraceSummary> & { id: string }): TraceSummary {
  return {
    name: over.id,
    timestamp: "2026-01-01T00:00:00Z",
    status: "ok",
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: 0,
    tags: [],
    ...over,
  };
}

describe("groupTracesIntoRuns", () => {
  it("groups traces sharing a sessionId into one run", () => {
    const runs = groupTracesIntoRuns([
      trace({ id: "t1", sessionId: "m1", totalTokens: 100, timestamp: "2026-01-01T09:02:00Z" }),
      trace({ id: "t2", sessionId: "m1", totalTokens: 50, timestamp: "2026-01-01T09:01:00Z" }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("m1");
    expect(runs[0].isSession).toBe(true);
    expect(runs[0].totalTokens).toBe(150);
    expect(runs[0].traces).toHaveLength(2);
    // newest trace first within the run
    expect(runs[0].traces[0].id).toBe("t1");
    expect(runs[0].latestTimestamp).toBe("2026-01-01T09:02:00Z");
  });

  it("treats a trace with no sessionId as its own singleton run", () => {
    const runs = groupTracesIntoRuns([trace({ id: "solo", name: "recon-scan" })]);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("solo");
    expect(runs[0].isSession).toBe(false);
    expect(runs[0].label).toBe("recon-scan");
  });

  it("marks a run as error if any trace errored, and unions agent tags", () => {
    const runs = groupTracesIntoRuns([
      trace({ id: "t1", sessionId: "m1", tags: ["agent:recon"], status: "ok" }),
      trace({ id: "t2", sessionId: "m1", tags: ["agent:exploit"], status: "error" }),
    ]);
    expect(runs[0].status).toBe("error");
    expect(runs[0].agents.sort()).toEqual(["exploit", "recon"]);
  });

  it("preserves run order by first appearance (newest-first input)", () => {
    const runs = groupTracesIntoRuns([
      trace({ id: "a", sessionId: "m2" }),
      trace({ id: "b", sessionId: "m1" }),
    ]);
    expect(runs.map((r) => r.id)).toEqual(["m2", "m1"]);
  });
});
