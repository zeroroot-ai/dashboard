// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Targeted unit test for resetUserMfaAction (hosted#206).
 *
 * Authz gating for the "admin" relation is exercised generically by the
 * matrix in authz.test.ts; this file asserts the action (a) is denied for a
 * plain member (admin-only, unlike revokeUserSessionsAction), (b) forwards
 * target_user_id for an admin caller, and (c) maps every response field.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  resetUserMFA: vi.fn(async () => ({
    sessionsTerminated: 2,
    otpCleared: true,
    u2fCleared: 1,
    passkeysCleared: 1,
    notified: true,
  })),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({ resetUserMFA: mocks.resetUserMFA })),
}));

vi.mock("@/src/lib/auth/schema", () => ({
  isCrossTenant: vi.fn(() => false),
}));

vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return {
    ...actual,
    requireActiveTenant: vi.fn(async () => "acme"),
  };
});

vi.mock("@/src/lib/audit/crd", () => ({
  emitCrdAudit: vi.fn(),
  emitCrdAuditFromGate: vi.fn(),
}));

import { getServerSession } from "@/src/lib/auth";
import { resetUserMfaAction } from "../reset-mfa";

const sessionMock = getServerSession as Mock;

function withSession(tenantId: string, role: "owner" | "admin" | "member") {
  sessionMock.mockResolvedValue({
    user: {
      id: "caller-1",
      name: "Caller",
      email: "caller@example.com",
      emailVerified: true,
      tenantId,
      tenants: [tenantId],
      rolesByTenant: { [tenantId]: role },
      roles: [role],
      groups: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeEach(() => {
  mocks.resetUserMFA.mockClear();
  sessionMock.mockReset();
});

describe("resetUserMfaAction", () => {
  it("forwards target_user_id and maps every response field for an admin caller", async () => {
    withSession("acme", "admin");
    const r = await resetUserMfaAction({ targetUserId: "bob" });
    expect(r).toEqual({
      ok: true,
      data: {
        sessionsTerminated: 2,
        otpCleared: true,
        u2fCleared: 1,
        passkeysCleared: 1,
        notified: true,
      },
    });
    expect(mocks.resetUserMFA).toHaveBeenCalledOnce();
    const [payload] = mocks.resetUserMFA.mock.calls[0] as unknown as [
      { targetUserId: string },
    ];
    expect(payload.targetUserId).toBe("bob");
  });

  it("allows the Owner (owner implies admin)", async () => {
    withSession("acme", "owner");
    const r = await resetUserMfaAction({ targetUserId: "owner-1" });
    expect(r.ok).toBe(true);
    expect(mocks.resetUserMFA).toHaveBeenCalledOnce();
  });

  it("denies a plain member, unlike revokeUserSessionsAction's self-service gate", async () => {
    withSession("acme", "member");
    const r = await resetUserMfaAction({ targetUserId: "bob" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
    expect(mocks.resetUserMFA).not.toHaveBeenCalled();
  });

  it("rejects empty targetUserId before any RPC", async () => {
    withSession("acme", "admin");
    const r = await resetUserMfaAction({ targetUserId: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BAD_INPUT");
    expect(mocks.resetUserMFA).not.toHaveBeenCalled();
  });
});
