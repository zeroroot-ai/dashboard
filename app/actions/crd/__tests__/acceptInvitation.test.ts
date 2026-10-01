// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for acceptInvitationAction.
 *
 * The one thing these assert is that setup_url reaches the caller. The daemon
 * mints that link with Zitadel's `returnCode`, never `sendCode`, so the identity
 * service emails nothing and the RPC response is the ONLY place the link
 * appears. The action used to drop it, which left an invited person with an
 * active membership, no credential, and a page telling them to watch for mail
 * that is never sent.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptInvitation: vi.fn(async (_req: Record<string, unknown>) => ({
    tenantId: "acme",
    userId: "u-1",
    setupUrl: "https://idp.example.com/ui/v2/invite?code=one-time",
  })),
}));

// serviceClient, not userClient: the invitee has no session, so the action
// calls the daemon as the dashboard SA (gibson#633).
vi.mock("@/src/lib/gibson-client", () => ({
  serviceClient: () => ({ acceptInvitation: mocks.acceptInvitation }),
  userClient: () => ({}),
}));

vi.mock("../_authz", () => ({ requireCrdSession: vi.fn() }));
vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return { ...actual, requireActiveTenant: vi.fn(async () => "acme") };
});
vi.mock("@/src/lib/audit/crd", () => ({ emitCrdAuditFromGate: vi.fn() }));

import { acceptInvitationAction } from "../member";

beforeEach(() => {
  mocks.acceptInvitation.mockReset();
  mocks.acceptInvitation.mockResolvedValue({
    tenantId: "acme",
    userId: "u-1",
    setupUrl: "https://idp.example.com/ui/v2/invite?code=one-time",
  });
});

describe("acceptInvitationAction", () => {
  it("returns the setup link, which is the only place it ever appears", async () => {
    const res = await acceptInvitationAction({ token: "rawtoken" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.setupUrl).toBe("https://idp.example.com/ui/v2/invite?code=one-time");
  });

  it("redeems by the token it was given and names no tenant", async () => {
    await acceptInvitationAction({ token: "rawtoken" });
    expect(mocks.acceptInvitation).toHaveBeenCalledWith({ token: "rawtoken" });
  });

  it("surfaces an empty setup link rather than inventing one", async () => {
    mocks.acceptInvitation.mockResolvedValue({ tenantId: "acme", userId: "u-1", setupUrl: "" });
    const res = await acceptInvitationAction({ token: "rawtoken" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.setupUrl).toBe("");
  });

  it("rejects an empty token without calling the daemon", async () => {
    const res = await acceptInvitationAction({ token: "" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("BAD_INPUT");
    expect(mocks.acceptInvitation).not.toHaveBeenCalled();
  });

  it("maps a refused redeem to FORBIDDEN", async () => {
    mocks.acceptInvitation.mockRejectedValue(
      new ConnectError("invalid or unknown invitation token", Code.PermissionDenied),
    );
    const res = await acceptInvitationAction({ token: "stale" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("FORBIDDEN");
  });
});
