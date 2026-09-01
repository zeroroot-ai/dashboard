/**
 * JobPanel tests (gibson#1706 lane E3): compose opens a job, a selected job
 * takes the next turn, a waiting job takes an answer, close asks for a
 * verdict and a score, and can_send / can_close gate the controls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { JobPanel } from "../JobPanel";
import type { MemberWithBankView } from "@/src/lib/banks/view";
import type { JobEventView, JobView } from "@/src/lib/jobs/view";

const openMutate = vi.fn();
const sendMutate = vi.fn();
const closeMutate = vi.fn();
const useJobsMock = vi.fn();
let feedEvents: JobEventView[] = [];
vi.mock("@/src/hooks/useJobs", () => ({
  useJobs: (f: unknown) => useJobsMock(f),
  useOpenJob: () => ({ mutate: openMutate, isPending: false }),
  useSendInput: () => ({ mutate: sendMutate, isPending: false }),
  useCloseJob: () => ({ mutate: closeMutate, isPending: false }),
  useJobEvents: () => ({ events: feedEvents, phase: "streaming" }),
}));

let sessionUserId = "u1";
vi.mock("@/src/lib/session-client", () => ({
  useSession: () => ({ data: { user: { id: sessionUserId, email: "u@x" } }, isPending: false, error: null, refetch: vi.fn() }),
}));
let tenantRole = "member";
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ currentTenant: { id: "t1" }, rolesByTenant: { t1: tenantRole } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const member: MemberWithBankView = {
  id: "mem-1", bankId: "bank-1", missionId: "", missionRunId: "", agentRunId: "run-1", sandboxId: "",
  state: "idle", jobsInFlight: 0, cap: 2, activeJobIds: [], claudeVersion: "2.1.0", lastHeartbeat: null,
  bankName: "crew", bankOwner: { kind: "user", id: "u1" },
};

function job(over: Partial<JobView> = {}): JobView {
  return {
    id: "job-1", bankId: "bank-1", memberId: "mem-1", state: "working",
    spec: { goal: "fix the login bug", repositories: [], credentialNames: [], inputs: [], acceptance: null, context: {} },
    claudeSessionId: "", openedBy: { kind: "user", id: "u1" }, openedAt: null, lastInputAt: null, closedAt: null,
    verdict: "unspecified", score: 0, deliverables: [], attempts: 0, ...over,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <JobPanel member={member} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  sessionUserId = "u1";
  tenantRole = "member";
  feedEvents = [];
  openMutate.mockReset();
  sendMutate.mockReset();
  closeMutate.mockReset();
  useJobsMock.mockReset();
  useJobsMock.mockReturnValue({ data: [] });
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.scrollIntoView = () => undefined;
});

describe("JobPanel", () => {
  it("with no job selected the compose box opens a goal-only job on this member", async () => {
    renderPanel();
    expect(screen.getByTestId("job-list-empty")).toBeInTheDocument();
    expect(screen.getByTestId("compose-box")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "fix the login bug" } });
    fireEvent.click(screen.getByTestId("compose-submit"));
    await waitFor(() => expect(openMutate).toHaveBeenCalledTimes(1));
    expect(openMutate.mock.calls[0][0]).toEqual({ bankId: "bank-1", memberId: "mem-1", goal: "fix the login bug" });
  });

  it("lists open jobs with state, opener and last input, and hides closed ones", () => {
    useJobsMock.mockReturnValue({ data: [job(), job({ id: "job-2", state: "closed" }), job({ id: "job-3", state: "waiting", openedBy: { kind: "component", id: "agent/scanner" } })] });
    renderPanel();
    const rows = screen.getAllByTestId("job-row");
    expect(rows).toHaveLength(2);
    expect(screen.getAllByTestId("job-state").map((el) => el.textContent)).toEqual(["working", "waiting"]);
    expect(rows[0]).toHaveTextContent("by me");
    expect(rows[1]).toHaveTextContent("by component agent/scanner");
    expect(useJobsMock).toHaveBeenCalledWith({ memberId: "mem-1" });
  });

  it("with a working job selected the box sends the next turn", async () => {
    useJobsMock.mockReturnValue({ data: [job()] });
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    expect(screen.getByTestId("turn-box")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "also add a test" } });
    fireEvent.click(screen.getByTestId("compose-submit"));
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(sendMutate.mock.calls[0][0]).toEqual({ message: "also add a test", kind: "turn" });
    expect(openMutate).not.toHaveBeenCalled();
  });

  it("with a waiting job selected the box becomes the answer box and sends ANSWER", async () => {
    useJobsMock.mockReturnValue({ data: [job({ state: "waiting" })] });
    feedEvents = [
      { seq: "1", occurredAt: null, kind: "state", jobId: "job-1", state: "waiting", input: null, deliverable: null, verdict: "unspecified", score: 0, message: "Which branch?" },
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    expect(screen.getByTestId("answer-box")).toBeInTheDocument();
    expect(screen.getByTestId("pending-question")).toHaveTextContent("Which branch?");
    fireEvent.change(screen.getByTestId("compose-input"), { target: { value: "main" } });
    fireEvent.keyDown(screen.getByTestId("compose-input"), { key: "Enter" });
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(sendMutate.mock.calls[0][0]).toEqual({ message: "main", kind: "answer" });
  });

  it("shows the selected job's events", () => {
    useJobsMock.mockReturnValue({ data: [job()] });
    feedEvents = [
      { seq: "1", occurredAt: null, kind: "opened", jobId: "job-1", state: "open", input: null, deliverable: null, verdict: "unspecified", score: 0, message: "" },
      { seq: "2", occurredAt: null, kind: "input", jobId: "job-1", state: "working", input: { id: "i", jobId: "job-1", message: "go", sender: { kind: "user", id: "u1" }, kind: "turn", sentAt: null }, deliverable: null, verdict: "unspecified", score: 0, message: "" },
    ];
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    expect(screen.getAllByTestId("job-event").map((el) => el.textContent)).toEqual(["opened", "turn from me: go"]);
  });

  it("close asks for a verdict and a score and calls CloseJob", async () => {
    useJobsMock.mockReturnValue({ data: [job()] });
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    fireEvent.click(screen.getByTestId("job-close-open"));
    fireEvent.change(screen.getByTestId("job-close-score"), { target: { value: "0.75" } });
    fireEvent.click(screen.getByTestId("job-close-submit"));
    await waitFor(() => expect(closeMutate).toHaveBeenCalledTimes(1));
    expect(closeMutate.mock.calls[0][0]).toEqual({ verdict: "accomplished", score: 0.75 });
  });

  it("close refuses a score outside 0..1 before the call leaves the browser", () => {
    useJobsMock.mockReturnValue({ data: [job()] });
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    fireEvent.click(screen.getByTestId("job-close-open"));
    fireEvent.change(screen.getByTestId("job-close-score"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("job-close-submit"));
    expect(screen.getByTestId("job-close-error")).toHaveTextContent("Score is 0 to 1");
    expect(closeMutate).not.toHaveBeenCalled();
  });

  it("without can_send the compose box is absent and says who to ask", () => {
    sessionUserId = "u2"; // not the bank owner, not the opener
    renderPanel();
    expect(screen.queryByTestId("compose-box")).toBeNull();
    expect(screen.getByTestId("compose-denied")).toHaveTextContent("can_send");
  });

  it("the opener of a job sends and closes it even without bank rights", () => {
    sessionUserId = "u2";
    useJobsMock.mockReturnValue({ data: [job({ openedBy: { kind: "user", id: "u2" } })] });
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    expect(screen.getByTestId("turn-box")).toBeInTheDocument();
    expect(screen.getByTestId("job-close-open")).toBeInTheDocument();
  });

  it("without can_close the close action is absent", () => {
    sessionUserId = "u2";
    // u2 opened nothing; a tenant member on a user-owned bank holds nothing the dashboard can see.
    useJobsMock.mockReturnValue({ data: [job({ openedBy: { kind: "user", id: "u1" } })] });
    renderPanel();
    fireEvent.click(screen.getByTestId("job-row"));
    expect(screen.queryByTestId("job-close-open")).toBeNull();
    expect(screen.queryByTestId("turn-box")).toBeNull();
  });
});
