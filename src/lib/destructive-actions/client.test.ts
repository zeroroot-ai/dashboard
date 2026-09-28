// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, afterEach } from "vitest";
import {
  getDestructiveActionsClient,
  DestructiveActionsBackendUnavailableError,
  __setDestructiveActionsClientForTest,
  __resetDestructiveActionsClientForTest,
} from "./client";
import type { DestructiveActionsClient } from "./client";
import type { PendingDestructiveAction } from "@/src/types/destructive-actions";

afterEach(() => {
  __resetDestructiveActionsClientForTest();
});

describe("getDestructiveActionsClient (default, unwired)", () => {
  it("listPending() rejects with DestructiveActionsBackendUnavailableError", async () => {
    await expect(getDestructiveActionsClient().listPending()).rejects.toBeInstanceOf(
      DestructiveActionsBackendUnavailableError,
    );
  });

  it("decide() rejects with DestructiveActionsBackendUnavailableError", async () => {
    await expect(
      getDestructiveActionsClient().decide("hyp-1", "approve"),
    ).rejects.toBeInstanceOf(DestructiveActionsBackendUnavailableError);
  });

  it("the error message names the seam so a reader knows this is a stub", () => {
    const err = new DestructiveActionsBackendUnavailableError();
    expect(err.message).toMatch(/DestructiveProofAuthorizer/);
    expect(err.name).toBe("DestructiveActionsBackendUnavailableError");
  });
});

describe("__setDestructiveActionsClientForTest", () => {
  it("swaps in a fake client, letting callers exercise the real seam without a live daemon", async () => {
    const pending: PendingDestructiveAction[] = [
      {
        id: "hyp-1:0",
        missionId: "m1",
        scopeId: "s1",
        hypothesisId: "hyp-1",
        claim: "port 6443 is unauthenticated",
        technique: "http-probe",
        predicateType: "status_code",
        predicateParams: { expect: 200 },
        action: "Send an authenticated request without credentials",
        blastRadius: "single host: 10.0.0.5",
        reversible: true,
        reversibilityNote: "read-only probe",
        requestedAt: "2026-09-28T00:00:00.000Z",
      },
    ];
    const fake: DestructiveActionsClient = {
      listPending: async () => pending,
      decide: async () => undefined,
    };
    __setDestructiveActionsClientForTest(fake);

    await expect(getDestructiveActionsClient().listPending()).resolves.toEqual(pending);
    await expect(getDestructiveActionsClient().decide("hyp-1:0", "approve")).resolves.toBeUndefined();
  });
});
