// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * HitlSettleQueueContent — the ADR-0123 HITL settle surface UI (dashboard#97).
 * The data hooks (src/hooks/useHitlSettle.ts) are mocked here; their own
 * contract against the real API route is covered by useHitlSettle.test.tsx.
 * This file verifies:
 *   1. Loading, empty, and populated states render.
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
  hypothesisId: "hyp-1",
  claim: "port 6443 on 10.0.0.5 is unauthenticated",
  proposer: "recon-agent",
  confidence: 0.72,
  evidence: [{ label: "Host", idProperties: { address: "10.0.0.5" } }],
  runId: "run-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({
    ok: true,
    settled: "true_positive",
    didSettle: true,
    effect: "Bet settled. The fleet's belief and this technique's reputation are updated.",
  });
});

describe("HitlSettleQueueContent", () => {
  it("renders a loading state while the query is in flight", () => {
    mockUseOpenBets.mockReturnValue({ isLoading: true, data: undefined, error: null });
    render(<HitlSettleQueueContent />);
    expect(screen.getByTestId("hitl-settle-skeleton")).toBeInTheDocument();
  });

  it("shows an empty state when no bet is open", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [] },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    expect(screen.getByText(/nothing.*open/i)).toBeInTheDocument();
  });

  it("renders the hypothesis, evidence, and a transcript link when a run is known", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
      error: null,
    });
    render(<HitlSettleQueueContent />);

    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    const withinRow = within(row);
    expect(withinRow.getByText(SAMPLE.claim)).toBeInTheDocument();
    expect(withinRow.getByText(/Host \(address=10\.0\.0\.5\)/)).toBeInTheDocument();
    expect(withinRow.getByText(SAMPLE.proposer)).toBeInTheDocument();
    const link = withinRow.getByRole("link", { name: /transcript/i });
    expect(link).toHaveAttribute("href", `/dashboard/traces/${SAMPLE.runId}`);
  });

  it("omits the transcript link when no run is known", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [{ ...SAMPLE, runId: "" }] },
      error: null,
    });
    render(<HitlSettleQueueContent />);
    const row = screen.getByTestId(`hitl-bet-${SAMPLE.id}`);
    expect(within(row).queryByRole("link", { name: /transcript/i })).not.toBeInTheDocument();
  });

  it("makes clear judging is asynchronous and never pauses the mission", () => {
    mockUseOpenBets.mockReturnValue({
      isLoading: false,
      data: { items: [SAMPLE] },
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
      data: { items: [SAMPLE] },
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
      data: { items: [SAMPLE] },
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
      data: { items: [SAMPLE] },
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
