/**
 * Targeted unit test for revokeUserSessionsAction (dashboard#717).
 *
 * Authz gating is exercised by the matrix in authz.test.ts; this file asserts
 * the action forwards target_user_id to UserService.RevokeUserSessions and
 * maps the response counts.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  revokeUserSessions: vi.fn(async () => ({ sessionsTerminated: 3, grantsRevoked: 3 })),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({ revokeUserSessions: mocks.revokeUserSessions })),
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
    getActiveTenant: vi.fn(async () => "acme"),
  };
});

vi.mock("@/src/lib/audit/crd", () => ({
  emitCrdAuditFromGate: vi.fn(),
}));

import { getServerSession } from "@/src/lib/auth";
import { revokeUserSessionsAction } from "../sessions";

const sessionMock = getServerSession as Mock;

function withMemberSession(tenantId: string) {
  sessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      name: "Caller",
      email: "caller@example.com",
      emailVerified: true,
      tenantId,
      tenants: [tenantId],
      rolesByTenant: { [tenantId]: "member" },
      roles: ["member"],
      groups: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeEach(() => {
  mocks.revokeUserSessions.mockClear();
  sessionMock.mockReset();
});

describe("revokeUserSessionsAction", () => {
  it("forwards target_user_id and maps the response counts", async () => {
    withMemberSession("acme");
    const r = await revokeUserSessionsAction({ targetUserId: "bob" });
    expect(r).toEqual({ ok: true, data: { sessionsTerminated: 3, grantsRevoked: 3 } });
    expect(mocks.revokeUserSessions).toHaveBeenCalledOnce();
    const [payload] = mocks.revokeUserSessions.mock.calls[0] as unknown as [
      { targetUserId: string },
    ];
    expect(payload.targetUserId).toBe("bob");
  });

  it("rejects empty targetUserId before any RPC", async () => {
    const r = await revokeUserSessionsAction({ targetUserId: "" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("BAD_INPUT");
    expect(mocks.revokeUserSessions).not.toHaveBeenCalled();
  });
});
