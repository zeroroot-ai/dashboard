// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * approveRegistrationAction (dashboard#193): an approval on the page calls the
 * daemon approval, which queues the tenant that the tenant operator builds.
 * The page reports a workspace only when the daemon queued one.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

const { mockApprove, mockSession } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockSession: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({ adminApproveRegistration: mockApprove }),
}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: mockSession }));

import { approveRegistrationAction } from "../registrations";
import { REGISTRATIONS_TEXT } from "@/components/gibson/registrations/texts";

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ user: { id: "admin-1" } });
});

describe("approveRegistrationAction", () => {
  it("calls the daemon approval with the registration id and returns the queued tenant", async () => {
    mockApprove.mockResolvedValue({ tenantId: "acme-research", ownerUserId: "u-1", planId: "team" });
    const res = await approveRegistrationAction("reg-1");
    expect(mockApprove).toHaveBeenCalledWith({ registrationId: "reg-1" });
    expect(res).toEqual({
      ok: true,
      data: { tenantId: "acme-research", ownerUserId: "u-1", planId: "team" },
    });
  });

  it("reports no workspace when another workspace has the name", async () => {
    mockApprove.mockRejectedValue(new ConnectError("taken", Code.AlreadyExists));
    expect(await approveRegistrationAction("reg-1")).toEqual({
      ok: false,
      error: REGISTRATIONS_TEXT.nameTaken,
      code: "name_taken",
    });
  });

  it("reports a decision that another administrator already made", async () => {
    mockApprove.mockRejectedValue(new ConnectError("decided", Code.FailedPrecondition));
    expect(await approveRegistrationAction("reg-1")).toEqual({
      ok: false,
      error: REGISTRATIONS_TEXT.alreadyDecided,
      code: "already_decided",
    });
  });

  it("calls nothing without a session", async () => {
    mockSession.mockResolvedValue(null);
    const res = await approveRegistrationAction("reg-1");
    expect(res.ok).toBe(false);
    expect(mockApprove).not.toHaveBeenCalled();
  });
});
