// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit test for the real destructive-action client (dashboard#99).
 * DestructiveAuthorizationService is mocked via `userClient`, so this proves
 * the proto → view mapping (reversibility enum, unix-ms timestamp) and the
 * approve/deny routing without a live daemon. The test-only seam is covered
 * too, since the route tests depend on it.
 */

import { describe, it, expect, afterEach, vi } from "vitest";

const mockListPending = vi.fn();
const mockApprove = vi.fn();
const mockDeny = vi.fn();

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn().mockReturnValue({
    listPendingDestructiveActions: (...args: unknown[]) => mockListPending(...args),
    approveDestructiveAction: (...args: unknown[]) => mockApprove(...args),
    denyDestructiveAction: (...args: unknown[]) => mockDeny(...args),
  }),
}));

vi.mock("server-only", () => ({}));

import { Reversibility } from "@/src/gen/gibson/daemon/destructiveauthz/v1/destructive_authz_pb";
import {
  getDestructiveActionsClient,
  __setDestructiveActionsClientForTest,
  __resetDestructiveActionsClientForTest,
} from "./client";
import type { DestructiveActionsClient } from "./client";
import type { PendingDestructiveAction } from "@/src/types/destructive-actions";

afterEach(() => {
  __resetDestructiveActionsClientForTest();
  vi.clearAllMocks();
});

describe("getDestructiveActionsClient (real, DestructiveAuthorizationService-backed)", () => {
  it("maps pending actions, including the reversibility enum and unix-ms timestamp", async () => {
    const ts = Date.parse("2026-09-28T00:00:00.000Z");
    mockListPending.mockResolvedValue({
      actions: [
        {
          actionId: "hyp-1",
          hypothesisId: "hyp-1",
          scopeId: "s1",
          missionId: "m1",
          technique: "T1190",
          predicateType: "status_code",
          requestedAtUnixMs: BigInt(ts),
          blastRadius: "single host: 10.0.0.5",
          reversibility: Reversibility.IRREVERSIBLE,
        },
      ],
    });

    const actions = await getDestructiveActionsClient().listPending();
    expect(mockListPending).toHaveBeenCalledWith({});
    expect(actions).toEqual([
      {
        id: "hyp-1",
        hypothesisId: "hyp-1",
        scopeId: "s1",
        missionId: "m1",
        technique: "T1190",
        predicateType: "status_code",
        blastRadius: "single host: 10.0.0.5",
        reversibility: "irreversible",
        requestedAt: "2026-09-28T00:00:00.000Z",
      },
    ]);
  });

  it("maps an unspecified reversibility and an empty timestamp honestly", async () => {
    mockListPending.mockResolvedValue({
      actions: [
        {
          actionId: "hyp-2",
          hypothesisId: "hyp-2",
          scopeId: "s1",
          missionId: "m1",
          technique: "T1078",
          predicateType: "exec",
          requestedAtUnixMs: BigInt(0),
          blastRadius: "",
          reversibility: Reversibility.UNSPECIFIED,
        },
      ],
    });

    const [action] = await getDestructiveActionsClient().listPending();
    expect(action.reversibility).toBe("unspecified");
    expect(action.requestedAt).toBe("");
    expect(action.blastRadius).toBe("");
  });

  it("routes approve to ApproveDestructiveAction by action id", async () => {
    mockApprove.mockResolvedValue({});
    await getDestructiveActionsClient().decide("hyp-1", "approve");
    expect(mockApprove).toHaveBeenCalledWith({ actionId: "hyp-1" });
    expect(mockDeny).not.toHaveBeenCalled();
  });

  it("routes deny to DenyDestructiveAction by action id", async () => {
    mockDeny.mockResolvedValue({});
    await getDestructiveActionsClient().decide("hyp-1", "deny");
    expect(mockDeny).toHaveBeenCalledWith({ actionId: "hyp-1" });
    expect(mockApprove).not.toHaveBeenCalled();
  });
});

describe("__setDestructiveActionsClientForTest", () => {
  it("swaps in a fake client and __reset restores the real one", async () => {
    const pending: PendingDestructiveAction[] = [
      {
        id: "hyp-9",
        hypothesisId: "hyp-9",
        scopeId: "s1",
        missionId: "m1",
        technique: "T1190",
        predicateType: "status_code",
        blastRadius: "",
        reversibility: "unspecified",
        requestedAt: "",
      },
    ];
    const fake: DestructiveActionsClient = {
      listPending: async () => pending,
      decide: async () => undefined,
    };
    __setDestructiveActionsClientForTest(fake);
    await expect(getDestructiveActionsClient().listPending()).resolves.toEqual(pending);

    __resetDestructiveActionsClientForTest();
    mockListPending.mockResolvedValue({ actions: [] });
    await expect(getDestructiveActionsClient().listPending()).resolves.toEqual([]);
  });
});
