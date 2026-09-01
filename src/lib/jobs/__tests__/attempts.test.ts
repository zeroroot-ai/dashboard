import { describe, it, expect } from "vitest";
import { deriveAttempts, reportSummary } from "../attempts";
import type { JobEventView } from "../view";

function report(seq: string, message: string): JobEventView {
  return {
    seq, occurredAt: null, kind: "input", jobId: "j", state: "working",
    input: { id: seq, jobId: "j", message, sender: { kind: "component", id: "agent/verifier" }, kind: "turn", sentAt: null },
    deliverable: null, verdict: "unspecified", score: 0, message: "",
  };
}
function personTurn(seq: string): JobEventView {
  return { ...report(seq, "also add a test"), input: { id: seq, jobId: "j", message: "also add a test", sender: { kind: "user", id: "u1" }, kind: "turn", sentAt: null } };
}

describe("deriveAttempts, fixture runs", () => {
  it("one attempt: the verifier passed first time", () => {
    const attempts = deriveAttempts({ attempts: 1, state: "closed", verdict: "accomplished", score: 0.95 }, []);
    expect(attempts).toEqual([{ pass: 1, report: "", outcome: "accomplished", score: 0.95 }]);
  });

  it("three attempts: two reports then a pass", () => {
    const events = [report("1", "Tests fail: login returns 500."), report("2", "Regression test missing.")];
    const attempts = deriveAttempts({ attempts: 3, state: "closed", verdict: "accomplished", score: 0.9 }, events);
    expect(attempts.map((a) => [a.pass, a.outcome, a.score])).toEqual([
      [1, "failed", null],
      [2, "failed", null],
      [3, "accomplished", 0.9],
    ]);
    expect(attempts[0].report).toBe("Tests fail: login returns 500.");
    expect(attempts[1].report).toBe("Regression test missing.");
  });

  it("a failed job: the passes ran out", () => {
    const events = [report("1", "still broken"), report("2", "still broken")];
    const attempts = deriveAttempts({ attempts: 3, state: "closed", verdict: "failed", score: 0.2 }, events);
    expect(attempts[2]).toEqual({ pass: 3, report: "", outcome: "failed", score: 0.2 });
  });

  it("an open job: the current pass is pending, and a person's turn is not a report", () => {
    const events = [report("1", "nope"), personTurn("2")];
    const attempts = deriveAttempts({ attempts: 0, state: "working", verdict: "unspecified", score: 0 }, events);
    expect(attempts.map((a) => a.outcome)).toEqual(["failed", "pending"]);
  });

  it("an abandoned job closes its last pass as abandoned", () => {
    const attempts = deriveAttempts({ attempts: 1, state: "closed", verdict: "abandoned", score: 0 }, []);
    expect(attempts[0].outcome).toBe("abandoned");
  });
});

describe("reportSummary", () => {
  it("keeps the first sentence and cuts long ones", () => {
    expect(reportSummary("Tests fail: login returns 500. Two files changed.")).toBe("Tests fail: login returns 500.");
    expect(reportSummary("a".repeat(200), 20)).toHaveLength(20);
    expect(reportSummary("   ")).toBe("");
  });
});
