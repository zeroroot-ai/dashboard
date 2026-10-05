// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * DestructiveActionQueueContent — the ADR-0132 authorization queue UI
 * (dashboard#99). The data hooks (src/hooks/useDestructiveActions.ts) are
 * mocked here; their own contract against the real API route is covered by
 * useDestructiveActions.test.tsx. This file verifies:
 *   1. Loading, empty, and populated states render.
 *   2. Each row surfaces action, blast radius, reversibility, predicate, and
 *      the hypothesis/bet it belongs to.
 *   3. Approve/deny call the mutation with the right arguments.
 *   4. The copy makes clear the mission is NOT blocked, only the action waits.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PendingDestructiveAction } from "@/src/types/destructive-actions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const mockUseDestructiveActions = vi.fn();
const mockMutateAsync = vi.fn();
vi.mock("@/src/hooks/useDestructiveActions", () => ({
  useDestructiveActions: () => mockUseDestructiveActions(),
  useDecideDestructiveAction: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

import { DestructiveActionQueueContent } from "../DestructiveActionQueueContent";

const SAMPLE: PendingDestructiveAction = {
  id: "hyp-1",
  hypothesisId: "hyp-1",
  scopeId: "s1",
  missionId: "m1",
  technique: "T1190",
  predicateType: "status_code",
  blastRadius: "single host: 10.0.0.5",
  reversibility: "irreversible",
  requestedAt: "2026-09-28T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue(undefined);
});

describe("DestructiveActionQueueContent", () => {
  it("renders a loading state while the query is in flight", () => {
    mockUseDestructiveActions.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<DestructiveActionQueueContent />);
    expect(screen.getByTestId("destructive-queue-skeleton")).toBeInTheDocument();
  });

  it("shows an empty state when nothing is pending", () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);
    expect(screen.getByText(/nothing.*awaiting/i)).toBeInTheDocument();
  });

  it("renders every field the ADR requires: action, blast radius, reversibility, predicate, and the bet", () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);

    const row = screen.getByTestId(`destructive-action-${SAMPLE.id}`);
    const withinRow = within(row);
    // The composed "what it would do" headline names technique + predicate.
    expect(withinRow.getByText(/Run the/i)).toBeInTheDocument();
    expect(withinRow.getByText(SAMPLE.blastRadius)).toBeInTheDocument();
    expect(withinRow.getAllByText(/irreversible/i).length).toBeGreaterThan(0);
    // technique + predicate both surface (badge + predicate field).
    expect(withinRow.getAllByText(new RegExp(SAMPLE.technique)).length).toBeGreaterThan(0);
    expect(withinRow.getAllByText(new RegExp(SAMPLE.predicateType)).length).toBeGreaterThan(0);
    expect(withinRow.getByText(new RegExp(SAMPLE.hypothesisId))).toBeInTheDocument();
  });

  it("surfaces an honest fallback when blast radius and reversibility are not yet classified", () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...SAMPLE, blastRadius: "", reversibility: "unspecified" }] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);
    const row = screen.getByTestId(`destructive-action-${SAMPLE.id}`);
    expect(within(row).getByText(/not yet classified/i)).toBeInTheDocument();
    expect(within(row).getByText(/not classified/i)).toBeInTheDocument();
  });

  it("makes clear the mission is not blocked, only the action waits", () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);
    expect(
      screen.getByText(/mission.*(is not|isn't|never) (blocked|paused|stalled)/i),
    ).toBeInTheDocument();
  });

  it("approve calls the mutation with decision=approve for that action's id", async () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);

    const row = screen.getByTestId(`destructive-action-${SAMPLE.id}`);
    await userEvent.click(within(row).getByRole("button", { name: /approve/i }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAMPLE.id, decision: "approve" }),
    );
  });

  it("deny calls the mutation with decision=deny for that action's id", async () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
      error: null,
    });
    render(<DestructiveActionQueueContent />);

    const row = screen.getByTestId(`destructive-action-${SAMPLE.id}`);
    await userEvent.click(within(row).getByRole("button", { name: /deny/i }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAMPLE.id, decision: "deny" }),
    );
  });

  it("renders an error state when the query fails", () => {
    mockUseDestructiveActions.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error("network exploded"),
    });
    render(<DestructiveActionQueueContent />);
    expect(screen.getByText(/network exploded/)).toBeInTheDocument();
  });
});
