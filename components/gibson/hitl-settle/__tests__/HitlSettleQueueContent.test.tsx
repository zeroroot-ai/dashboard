// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * HitlSettleQueueContent — the ADR-0023 HITL settle surface UI (dashboard#97).
 * The data hooks (src/hooks/useHitlSettle.ts) are mocked here; their own
 * contract against the real API route is covered by useHitlSettle.test.tsx.
 * This file verifies:
 *   1. Loading, "backend not wired", empty, and populated states render.
 *   2. Each row surfaces the hypothesis (claim), evidence, and a link to the
 *      proposing agent's transcript when a runId is known.
 *   3. true-positive / false-positive / dismiss call the mutation with the
 *      right arguments.
 *   4. The copy makes clear judging is asynchronous (no mission pauses).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OpenBetForReview } from "@/src/types/hitl-settle";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockUseOpenBets = vi.fn();
const mockMutateAsync = vi.fn();
vi.mock("@/src/hooks/useHitlSettle", () => ({
  useOpenBets: () => mockUseOpenBets(),
  useSubmitBetVerdict: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

import { HitlSettleQueueContent } from "../HitlSettleQueueContent";

const SAMPLE: OpenBetForReview = {
  id: "hyp-1",
  missionId: "m1",
  scopeId: "s1",
  hypothesisId: "hyp-1",
  claim: "port 6443 on 10.0.0.5 is unauthenticated",
  proposer: "recon-agent",
  confidence: 0.72,
  technique: "http-probe",
  evidence: [{ description: "200 OK with no Authorization header" }],
  runId: "run-1",
  requestedAt: "2026-09-28T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({
    ok: true,
    settled: "true_positive",
    didSettle: true,
    effect: "belief and reputation updated",
  });
});

describe("HitlSettleQueueContent", () => {
  it("renders a loading state while the query is in flight", () => {
    mockUseOpenBets.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<HitlSettleQueueContent />);
    expect(screen.getByTestId("hitl-settle-skeleton")).toBeInTheDocument();
  });

  it("shows a distinct 'not connected' state when the backend is unwired, not a generic error", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [], available: false },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    expect(screen.getByText(/not (yet )?connected/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing.*open/i)).not.toBeInTheDocument();
  });

  it("shows an empty state when the backend is wired and no bet is open", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    expect(screen.getByText(/nothing.*open/i)).toBeInTheDocument();
  });

  it("renders the hypothesis, evidence, and a transcript link when a run is known", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);

    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    const withinRow = within(row);
    expect(withinRow.getByText(SAMPLE.claim)).toBeInTheDocument();
    expect(withinRow.getByText(SAMPLE.evidence[0]!.description)).toBeInTheDocument();
    expect(withinRow.getByText(SAMPLE.proposer)).toBeInTheDocument();
    const link = withinRow.getByRole("link", { name: /transcript/i });
    expect(link).toHaveAttribute("href", `/dashboard/traces/${SAMPLE.runId}`);
  });

  it("omits the transcript link when no run is known", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...SAMPLE, runId: "" }], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    expect(within(row).queryByRole("link", { name: /transcript/i })).not.toBeInTheDocument();
  });

  it("makes clear judging is asynchronous and never pauses the mission", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    expect(
      screen.getByText(/(never|does not|won't) (block|pause|stall).*mission/i),
    ).toBeInTheDocument();
  });

  it("true positive calls the mutation with verdict=true_positive for that bet's id", async () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);

    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    await userEvent.click(within(row).getByRole("button", { name: /true.positive/i }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAMPLE.id, verdict: "true_positive" }),
    );
  });

  it("false positive calls the mutation with verdict=false_positive for that bet's id", async () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);

    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    await userEvent.click(within(row).getByRole("button", { name: /false.positive/i }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAMPLE.id, verdict: "false_positive" }),
    );
  });

  it("dismiss calls the mutation with verdict=dismiss for that bet's id", async () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE], available: true },
      error: null,
    });
    render(<HitlSettleQueueContent />);

    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    await userEvent.click(within(row).getByRole("button", { name: /dismiss/i }));

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: SAMPLE.id, verdict: "dismiss" }),
    );
  });

  it("renders an error state when the query fails", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: undefined,
      error: new Error("network exploded"),
    });
    render(<HitlSettleQueueContent />);
    expect(screen.getByText(/network exploded/)).toBeInTheDocument();
  });
});
