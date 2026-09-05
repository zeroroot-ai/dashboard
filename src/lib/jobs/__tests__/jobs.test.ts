import { describe, it, expect } from "vitest";
import { jobAcceptsInput, pendingQuestion, senderLabel, type JobEventView } from "../view";
import { closeJobSchema, openJobSchema, sendInputSchema } from "../schema";
import { deriveJobPermissions } from "../permissions";

function ev(over: Partial<JobEventView>): JobEventView {
  return { seq: "1", occurredAt: null, kind: "state", jobId: "j", state: "working", input: null, deliverable: null, verdict: "unspecified", score: 0, message: "", ...over };
}

describe("job view helpers", () => {
  it("open, working and waiting accept input; closed does not", () => {
    expect(jobAcceptsInput("open")).toBe(true);
    expect(jobAcceptsInput("working")).toBe(true);
    expect(jobAcceptsInput("waiting")).toBe(true);
    expect(jobAcceptsInput("closed")).toBe(false);
  });
  it("finds the pending question from the last waiting state, until an input answers it", () => {
    expect(pendingQuestion([ev({ seq: "1", state: "working" }), ev({ seq: "2", state: "waiting", message: "Which branch?" })])).toBe("Which branch?");
    expect(pendingQuestion([ev({ seq: "1", state: "waiting", message: "Q" }), ev({ seq: "2", kind: "input" })])).toBeNull();
    expect(pendingQuestion([ev({ seq: "1", state: "waiting" })])).toBe("The member waits for your answer.");
  });
  it("names senders from my point of view", () => {
    expect(senderLabel({ kind: "user", id: "u1" }, "u1")).toBe("me");
    expect(senderLabel({ kind: "component", id: "agent/verifier" }, "u1")).toBe("component agent/verifier");
    expect(senderLabel({ kind: "service", id: "s" }, "u1")).toBe("platform");
  });
});

describe("job schemas mirror the daemon", () => {
  it("open needs a bank and a goal", () => {
    expect(openJobSchema.safeParse({ bankId: "b", memberId: "", goal: "do it" }).success).toBe(true);
    expect(openJobSchema.safeParse({ bankId: "b", memberId: "", goal: "  " }).success).toBe(false);
  });
  it("a client never sends wrap_up", () => {
    expect(sendInputSchema.safeParse({ message: "m", kind: "turn" }).success).toBe(true);
    expect(sendInputSchema.safeParse({ message: "m", kind: "answer" }).success).toBe(true);
    expect(sendInputSchema.safeParse({ message: "m", kind: "wrap_up" }).success).toBe(false);
  });
  it("close needs a real verdict and a score in 0..1", () => {
    expect(closeJobSchema.safeParse({ verdict: "accomplished", score: "0.8" }).success).toBe(true);
    expect(closeJobSchema.safeParse({ verdict: "abandoned", score: 1 }).success).toBe(false);
    expect(closeJobSchema.safeParse({ verdict: "failed", score: 1.5 }).success).toBe(false);
  });
});

describe("deriveJobPermissions follows the FGA model", () => {
  const none = { canManage: false, canSend: false };
  const owner = { canManage: true, canSend: true };
  it("the opener sends and closes", () => {
    expect(deriveJobPermissions({ kind: "user", id: "u1" }, none, "u1")).toEqual({ canSend: true, canClose: true });
  });
  it("the bank owner sends and closes a job someone else opened", () => {
    expect(deriveJobPermissions({ kind: "user", id: "u2" }, owner, "u1")).toEqual({ canSend: true, canClose: true });
  });
  it("a bank sender who did not open the job sends but does not close", () => {
    expect(deriveJobPermissions({ kind: "user", id: "u2" }, { canManage: false, canSend: true }, "u1")).toEqual({ canSend: true, canClose: false });
  });
  it("anyone else gets nothing the dashboard can vouch for", () => {
    expect(deriveJobPermissions({ kind: "component", id: "c" }, none, "u1")).toEqual({ canSend: false, canClose: false });
  });
});
