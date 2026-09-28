// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, afterEach } from "vitest";
import {
  getHitlSettleClient,
  HitlSettleBackendUnavailableError,
  __setHitlSettleClientForTest,
  __resetHitlSettleClientForTest,
} from "./client";
import type { HitlSettleClient } from "./client";
import type { OpenBetForReview } from "@/src/types/hitl-settle";

afterEach(() => {
  __resetHitlSettleClientForTest();
});

describe("getHitlSettleClient (default, unwired)", () => {
  it("listOpenBets() rejects with HitlSettleBackendUnavailableError", async () => {
    await expect(getHitlSettleClient().listOpenBets()).rejects.toBeInstanceOf(
      HitlSettleBackendUnavailableError,
    );
  });

  it("submitVerdict() rejects with HitlSettleBackendUnavailableError", async () => {
    await expect(
      getHitlSettleClient().submitVerdict("hyp-1", "true_positive"),
    ).rejects.toBeInstanceOf(HitlSettleBackendUnavailableError);
  });

  it("the error message names the seam so a reader knows this is a stub", () => {
    const err = new HitlSettleBackendUnavailableError();
    expect(err.message).toMatch(/SettleBetByHITL/);
    expect(err.name).toBe("HitlSettleBackendUnavailableError");
  });
});

describe("__setHitlSettleClientForTest", () => {
  it("swaps in a fake client, letting callers exercise the real seam without a live daemon", async () => {
    const pending: OpenBetForReview[] = [
      {
        id: "hyp-1",
        missionId: "m1",
        scopeId: "s1",
        hypothesisId: "hyp-1",
        claim: "port 6443 is unauthenticated",
        proposer: "recon-agent",
        confidence: 0.72,
        technique: "http-probe",
        evidence: [{ description: "200 OK with no Authorization header" }],
        runId: "run-1",
        requestedAt: "2026-09-28T00:00:00.000Z",
      },
    ];
    const fake: HitlSettleClient = {
      listOpenBets: async () => pending,
      submitVerdict: async () => ({
        ok: true,
        settled: "true_positive",
        didSettle: true,
        effect: "belief and reputation updated",
      }),
    };
    __setHitlSettleClientForTest(fake);

    await expect(getHitlSettleClient().listOpenBets()).resolves.toEqual(pending);
    await expect(
      getHitlSettleClient().submitVerdict("hyp-1", "true_positive"),
    ).resolves.toEqual({
      ok: true,
      settled: "true_positive",
      didSettle: true,
      effect: "belief and reputation updated",
    });
  });
});
