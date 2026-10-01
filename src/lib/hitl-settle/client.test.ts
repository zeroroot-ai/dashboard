// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit test for the real HITL settle client (dashboard#97). WorldService is
 * mocked via `userClient`, so this proves the proto → view mapping and the
 * verdict/effect composition without a live daemon. The test-only seam
 * (`__set…ForTest`) is covered too, since the route tests depend on it.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const mockListOpenBets = vi.fn();
const mockSettleBetByHITL = vi.fn();

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn().mockReturnValue({
    listOpenBets: (...args: unknown[]) => mockListOpenBets(...args),
    settleBetByHITL: (...args: unknown[]) => mockSettleBetByHITL(...args),
  }),
}));

vi.mock("server-only", () => ({}));

import {
  getHitlSettleClient,
  __setHitlSettleClientForTest,
  __resetHitlSettleClientForTest,
} from "./client";
import type { HitlSettleClient } from "./client";
import type { OpenBetForReview } from "@/src/types/hitl-settle";

afterEach(() => {
  __resetHitlSettleClientForTest();
  vi.clearAllMocks();
});

describe("getHitlSettleClient (real, WorldService-backed)", () => {
  it("maps ListOpenBets proto bets into view bets, including referenced evidence", async () => {
    mockListOpenBets.mockResolvedValue({
      bets: [
        {
          hypothesisId: "hyp-1",
          claim: "port 6443 is unauthenticated",
          proposer: "recon-agent",
          confidence: 0.72,
          evidence: [{ label: "Host", idProperties: { address: "10.0.0.5" } }],
          runId: "run-1",
        },
      ],
    });

    const bets = await getHitlSettleClient().listOpenBets();
    expect(mockListOpenBets).toHaveBeenCalledWith({});
    expect(bets).toEqual([
      {
        id: "hyp-1",
        hypothesisId: "hyp-1",
        claim: "port 6443 is unauthenticated",
        proposer: "recon-agent",
        confidence: 0.72,
        evidence: [{ label: "Host", idProperties: { address: "10.0.0.5" } }],
        runId: "run-1",
      },
    ]);
  });

  it("settles a true_positive and reports didSettle=true", async () => {
    mockSettleBetByHITL.mockResolvedValue({ settled: true });
    const res = await getHitlSettleClient().submitVerdict("hyp-1", "true_positive");
    expect(mockSettleBetByHITL).toHaveBeenCalledWith({
      hypothesisId: "hyp-1",
      verdict: "true_positive",
    });
    expect(res.settled).toBe("true_positive");
    expect(res.didSettle).toBe(true);
    expect(res.effect).toMatch(/settled/i);
  });

  it("treats dismiss as label-only: didSettle=false with an honest effect", async () => {
    mockSettleBetByHITL.mockResolvedValue({ settled: false });
    const res = await getHitlSettleClient().submitVerdict("hyp-1", "dismiss");
    expect(mockSettleBetByHITL).toHaveBeenCalledWith({ hypothesisId: "hyp-1", verdict: "dismiss" });
    expect(res.didSettle).toBe(false);
    expect(res.effect).toMatch(/dismiss|stays open/i);
  });
});

describe("__setHitlSettleClientForTest", () => {
  it("swaps in a fake client and __reset restores the real one", async () => {
    const pending: OpenBetForReview[] = [
      {
        id: "hyp-9",
        hypothesisId: "hyp-9",
        claim: "a different claim",
        proposer: "scanner",
        confidence: 0.5,
        evidence: [],
        runId: "",
      },
    ];
    const fake: HitlSettleClient = {
      listOpenBets: async () => pending,
      submitVerdict: async () => ({
        ok: true,
        settled: "true_positive",
        didSettle: true,
        effect: "stubbed",
      }),
    };
    __setHitlSettleClientForTest(fake);
    await expect(getHitlSettleClient().listOpenBets()).resolves.toEqual(pending);

    __resetHitlSettleClientForTest();
    mockListOpenBets.mockResolvedValue({ bets: [] });
    await expect(getHitlSettleClient().listOpenBets()).resolves.toEqual([]);
  });
});
