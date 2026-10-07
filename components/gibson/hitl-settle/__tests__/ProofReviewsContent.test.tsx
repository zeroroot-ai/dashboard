// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * ProofReviewsContent (dashboard#228). The data hooks are mocked. This file
 * verifies that a reviewer sees each proof with its evidence, that the three
 * verdicts settle the bet through the HITL settle mutation, and that a
 * second page loads on request.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProofReviewItem } from "@/src/types/proof-review";
import { PROOF_REVIEW_TEXTS } from "../proof-review-texts";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mockUseProofReviews = vi.fn();
const mockMutateAsync = vi.fn();
vi.mock("@/src/hooks/useProofReviews", () => ({
  useProofReviews: () => mockUseProofReviews(),
}));
vi.mock("@/src/hooks/useHitlSettle", () => ({
  useSubmitBetVerdict: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

import { ProofReviewsContent } from "../ProofReviewsContent";

const SAMPLE: ProofReviewItem = {
  hypothesisId: "hyp-1",
  missionId: "mission-1",
  scopeId: "scope-1",
  technique: "T1190",
  evidence: [{ type: "http_response", title: "the admin page", content: "HTTP/1.1 200 OK" }],
  submittedAt: "2026-10-06T10:00:00.000Z",
};

function page(items: ProofReviewItem[], extra: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    error: null,
    data: { pages: [{ items, nextPageToken: "" }] },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockMutateAsync.mockResolvedValue({ ok: true, settled: "true_positive", didSettle: true, effect: "settled" });
});

describe("ProofReviewsContent", () => {
  it("renders a loading state", () => {
    mockUseProofReviews.mockReturnValue({ ...page([]), isLoading: true, data: undefined });
    render(<ProofReviewsContent />);
    expect(screen.getByTestId("proof-reviews-skeleton")).toBeInTheDocument();
  });

  it("shows the empty state when no proof waits", () => {
    mockUseProofReviews.mockReturnValue(page([]));
    render(<ProofReviewsContent />);
    expect(screen.getByText(PROOF_REVIEW_TEXTS.emptyTitle)).toBeInTheDocument();
  });

  it("shows each proof with the evidence the agent typed", () => {
    mockUseProofReviews.mockReturnValue(page([SAMPLE]));
    render(<ProofReviewsContent />);
    const row = screen.getByTestId("proof-review-hyp-1");
    expect(within(row).getByText(/T1190/)).toBeInTheDocument();
    expect(within(row).getByText("mission-1")).toBeInTheDocument();
    expect(within(row).getByText("http_response")).toBeInTheDocument();
    expect(within(row).getByText("the admin page")).toBeInTheDocument();
    expect(within(row).getByText("HTTP/1.1 200 OK")).toBeInTheDocument();
  });

  it.each([
    ["True positive", "true_positive"],
    ["False positive", "false_positive"],
    ["Dismiss", "dismiss"],
  ])("%s settles the bet of the proof with the verdict %s", async (label, verdict) => {
    mockUseProofReviews.mockReturnValue(page([SAMPLE]));
    render(<ProofReviewsContent />);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(label) }));
    expect(mockMutateAsync).toHaveBeenCalledWith({ id: "hyp-1", verdict });
  });

  it("loads the next page on request", async () => {
    const fetchNextPage = vi.fn();
    mockUseProofReviews.mockReturnValue(page([SAMPLE], { hasNextPage: true, fetchNextPage }));
    render(<ProofReviewsContent />);
    await userEvent.click(screen.getByRole("button", { name: PROOF_REVIEW_TEXTS.showMore }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });
});
