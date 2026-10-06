// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * RunChainTab (dashboard#227): a run with no parent, a chain of three runs,
 * the checkpoints with the snapshot mark, the rewind dialog, and a user who
 * may not rewind. The texts are the approved texts of dashboard#227.
 */

import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { mockListRuns, mockCheckpoints, mockRewind, auth, mockToast } = vi.hoisted(() => ({
  mockListRuns: vi.fn(),
  mockCheckpoints: vi.fn(),
  mockRewind: vi.fn(),
  auth: { allowed: true, loading: false },
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/app/actions/missions/runs", () => ({
  listMissionRunsAction: mockListRuns,
  getMissionCheckpointsAction: mockCheckpoints,
  rewindMissionAction: mockRewind,
}));
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: () => auth,
}));
vi.mock("sonner", () => ({ toast: mockToast }));

import { RunChainTab } from "../RunChainTab";

function run(n: number, id: string, parent = "", checkpoint = "") {
  return {
    missionId: id,
    runNumber: n,
    status: "completed",
    createdAt: 0,
    parentMissionId: parent,
    parentCheckpointId: checkpoint,
  };
}

const CHECKPOINTS: Record<string, unknown[]> = {
  r1: [
    { checkpointId: "c-recon", nodeId: "recon", endedAt: "2026-10-05T10:00:00Z", hasSnapshot: true },
    { checkpointId: "c-exploit", nodeId: "exploit", endedAt: "2026-10-05T10:05:00Z", hasSnapshot: false },
  ],
  r2: [{ checkpointId: "c-report", nodeId: "report", endedAt: "2026-10-05T11:00:00Z", hasSnapshot: false }],
  r3: [],
};

function renderTab(missionId = "r1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RunChainTab missionId={missionId} missionName="audit" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockListRuns.mockReset();
  mockCheckpoints.mockReset().mockImplementation(async (id: string) => ({
    ok: true,
    data: CHECKPOINTS[id] ?? [],
  }));
  mockRewind.mockReset();
  mockToast.success.mockReset();
  mockToast.error.mockReset();
  auth.allowed = true;
  auth.loading = false;
});

describe("RunChainTab", () => {
  it("states that a mission with no rewind has one run", async () => {
    mockListRuns.mockResolvedValue({ ok: true, data: [run(1, "r1")] });
    renderTab();
    expect(await screen.findByText("This mission has one run.")).toBeInTheDocument();
  });

  it("shows a chain of three runs with each parent and checkpoint", async () => {
    mockListRuns.mockResolvedValue({
      ok: true,
      data: [run(1, "r1"), run(2, "r2", "r1", "c-exploit"), run(3, "r3", "r2", "c-report")],
    });
    renderTab("r3");

    const items = await screen.findAllByTestId("run-chain-run");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/^Run 1$/);
    await waitFor(() =>
      expect(items[1]).toHaveTextContent('Run 2, from Run 1 at checkpoint "exploit"'),
    );
    await waitFor(() =>
      expect(items[2]).toHaveTextContent('Run 3, from Run 2 at checkpoint "report"'),
    );
  });

  it("shows each checkpoint with its node, its time and the snapshot mark", async () => {
    mockListRuns.mockResolvedValue({ ok: true, data: [run(1, "r1")] });
    renderTab();

    const rows = await screen.findAllByTestId("checkpoint");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/^recon, ended /);
    expect(within(rows[0]).getByText("Sandbox state saved")).toBeInTheDocument();
    expect(
      within(rows[1]).getByText(
        "Sandbox state not saved. A rewind starts this node with a clean sandbox.",
      ),
    ).toBeInTheDocument();
  });

  it("rewinds with the changed instruction of that node and names the new run", async () => {
    mockListRuns
      .mockResolvedValueOnce({ ok: true, data: [run(1, "r1")] })
      .mockResolvedValue({ ok: true, data: [run(1, "r1"), run(2, "r2", "r1", "c-exploit")] });
    mockRewind.mockResolvedValue({ ok: true, data: { missionId: "r2" } });
    const user = userEvent.setup();
    renderTab();

    const rows = await screen.findAllByTestId("checkpoint");
    await user.click(within(rows[1]).getByRole("button", { name: "Rewind to here" }));

    expect(screen.getByText('Rewind to "exploit"')).toBeInTheDocument();
    expect(
      screen.getByText(/This starts a new run from this checkpoint\. It deletes nothing\./),
    ).toHaveTextContent("Run 1 stays as it is.");
    expect(screen.getByText("You can change the instruction of this node only.")).toBeInTheDocument();
    await user.type(screen.getByLabelText('Instruction for "exploit"'), "try the other port");
    await user.click(screen.getByRole("button", { name: "Start new run" }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("Run 2 started."));
    expect(mockRewind).toHaveBeenCalledWith(
      expect.objectContaining({
        missionId: "r1",
        checkpointId: "c-exploit",
        instruction: "try the other port",
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("states the failure with the reason", async () => {
    mockListRuns.mockResolvedValue({ ok: true, data: [run(1, "r1")] });
    mockRewind.mockResolvedValue({ ok: false, error: "the checkpoint is gone", code: "rpc_failed" });
    const user = userEvent.setup();
    renderTab();

    const rows = await screen.findAllByTestId("checkpoint");
    await user.click(within(rows[0]).getByRole("button", { name: "Rewind to here" }));
    await user.click(screen.getByRole("button", { name: "Start new run" }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith("The rewind did not start. the checkpoint is gone"),
    );
  });

  it("shows no rewind button and no message to a user who may not run the mission", async () => {
    auth.allowed = false;
    mockListRuns.mockResolvedValue({ ok: true, data: [run(1, "r1")] });
    renderTab();

    await screen.findAllByTestId("checkpoint");
    expect(screen.queryByRole("button", { name: "Rewind to here" })).toBeNull();
  });
});
