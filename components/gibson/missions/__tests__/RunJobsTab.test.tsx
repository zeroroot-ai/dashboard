import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";
import { RunJobsTab } from "../RunJobsTab";
import type { JobEventView, JobView } from "@/src/lib/jobs/view";

const useRunJobsMock = vi.fn();
vi.mock("@/src/hooks/useRunJobs", () => ({ useRunJobs: (id: string) => useRunJobsMock(id) }));
let feeds: Record<string, JobEventView[]> = {};
vi.mock("@/src/hooks/useJobs", () => ({ useJobEvents: (id: string) => ({ events: feeds[id] ?? [], phase: "streaming" }) }));
vi.mock("@/src/hooks/useMemberRuns", () => ({
  useMemberRuns: () => new Map([["run-1", { id: "mem-1", agentRunId: "run-1" }]]),
}));

function job(over: Partial<JobView>): JobView {
  return {
    id: "job-1", bankId: "b", memberId: "mem-1", state: "closed",
    spec: { goal: "Fix the findings.", repositories: [], credentialNames: [], inputs: [], acceptance: null, context: { mission_run_id: "m1", node_id: "fix" } },
    claudeSessionId: "", openedBy: { kind: "service", id: "executor" }, openedAt: null, lastInputAt: null, closedAt: null,
    verdict: "accomplished", score: 0.9, deliverables: [], attempts: 1, ...over,
  };
}
function report(seq: string, message: string): JobEventView {
  return { seq, occurredAt: null, kind: "input", jobId: "job-1", state: "working", input: { id: seq, jobId: "job-1", message, sender: { kind: "component", id: "agent/verifier" }, kind: "turn", sentAt: null }, deliverable: null, verdict: "unspecified", score: 0, message: "" };
}

beforeEach(() => {
  feeds = {};
  useRunJobsMock.mockReset();
});

describe("RunJobsTab", () => {
  it("says when the run opened no job", () => {
    useRunJobsMock.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<RunJobsTab missionId="m1" />);
    expect(screen.getByTestId("run-jobs-empty")).toBeInTheDocument();
    expect(useRunJobsMock).toHaveBeenCalledWith("m1");
  });

  it("one attempt: pass 1 accomplished with its score, the node, the console link and the merge request", () => {
    useRunJobsMock.mockReturnValue({
      data: [job({ deliverables: [{ kind: "merge_request", ref: "!42", url: "https://forge/mr/42" }, { kind: "push_branch", ref: "job/job-1", url: "" }] })],
      isLoading: false, error: null,
    });
    render(<RunJobsTab missionId="m1" />);
    expect(screen.getByText("node fix")).toBeInTheDocument();
    expect(screen.getByTestId("run-job-state")).toHaveTextContent("accomplished");
    expect(screen.getAllByTestId("attempt")).toHaveLength(1);
    expect(screen.getByTestId("attempt-outcome")).toHaveTextContent("accomplished 0.90");
    expect(screen.getByTestId("run-job-console")).toHaveAttribute("href", "/dashboard/sandboxes?run=run-1");
    const deliverables = screen.getAllByTestId("deliverable");
    expect(deliverables).toHaveLength(2);
    expect(deliverables[0].querySelector("a")).toHaveAttribute("href", "https://forge/mr/42");
    expect(deliverables[1].querySelector("a")).toBeNull();
  });

  it("three attempts: two failed passes with their report summaries, then the pass", () => {
    feeds["job-1"] = [report("1", "Tests fail: login returns 500. Details follow."), report("2", "Regression test missing.")];
    useRunJobsMock.mockReturnValue({ data: [job({ attempts: 3 })], isLoading: false, error: null });
    render(<RunJobsTab missionId="m1" />);
    const rows = screen.getAllByTestId("attempt");
    expect(rows.map((r) => r.getAttribute("data-outcome"))).toEqual(["failed", "failed", "accomplished"]);
    expect(screen.getAllByTestId("attempt-report").map((r) => r.textContent)).toEqual(["Tests fail: login returns 500.", "Regression test missing."]);
  });

  it("a failed job: the last pass failed with its score and nothing left the sandbox", () => {
    feeds["job-1"] = [report("1", "nope"), report("2", "nope")];
    useRunJobsMock.mockReturnValue({ data: [job({ attempts: 3, verdict: "failed", score: 0.1 })], isLoading: false, error: null });
    render(<RunJobsTab missionId="m1" />);
    expect(screen.getByTestId("run-job-state")).toHaveTextContent("failed");
    const rows = screen.getAllByTestId("attempt");
    expect(rows[2]).toHaveAttribute("data-outcome", "failed");
    expect(rows[2].querySelector('[data-testid="attempt-outcome"]')).toHaveTextContent("failed 0.10");
    expect(screen.getByTestId("deliverables-empty")).toHaveTextContent("Nothing left the sandbox.");
  });
});
