/**
 * Unit tests for revokeMemberAction (dashboard#715).
 *
 * revokeMemberAction now calls the daemon's MembershipService, SetTenantRole
 * (remove) for active members, CancelInvitation for pending invitations, and
 * runs a last-active-owner safeguard against the daemon roster
 * (listMembersAction) before any mutation.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  setTenantRole: vi.fn(async (_req: Record<string, unknown>) => ({})),
  cancelInvitation: vi.fn(async (_req: Record<string, unknown>) => ({})),
  requireCrdSession: vi.fn(),
}));

vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: mocks.listMembers,
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({
    setTenantRole: mocks.setTenantRole,
    cancelInvitation: mocks.cancelInvitation,
  }),
}));

vi.mock("../_authz", () => ({
  requireCrdSession: mocks.requireCrdSession,
}));

vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return { ...actual, requireActiveTenant: vi.fn(async () => "acme") };
});

vi.mock("@/src/lib/audit/crd", () => ({ emitCrdAuditFromGate: vi.fn() }));

import { revokeMemberAction } from "../member";

function member(over: { userId?: string; email?: string; role: string; status?: string }) {
  return {
    userId: over.userId ?? "",
    displayName: "",
    email: over.email ?? `${over.userId}@example.com`,
    role: over.role,
    joinedAt: "",
    status: over.status ?? "active",
  };
}

beforeEach(() => {
  mocks.listMembers.mockReset();
  mocks.setTenantRole.mockReset();
  mocks.setTenantRole.mockResolvedValue({});
  mocks.cancelInvitation.mockReset();
  mocks.cancelInvitation.mockResolvedValue({});
  // Authz gate: allow.
  mocks.requireCrdSession.mockResolvedValue({
    ok: true,
    session: { user: { id: "caller" } },
    userId: "caller",
  });
});

describe("revokeMemberAction, last-owner safeguard", () => {
  it("blocks removal of the last active owner (no mutation)", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "o1", role: "owner" })],
    });
    const r = await revokeMemberAction({ userId: "o1", email: "o1@example.com", status: "active" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect((r as { error: string }).error).toMatch(/last owner/i);
    expect(mocks.setTenantRole).not.toHaveBeenCalled();
  });

  it("allows removal when two active owners exist", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "o1", role: "owner" }), member({ userId: "o2", role: "owner" })],
    });
    const r = await revokeMemberAction({ userId: "o1", email: "o1@example.com", status: "active" });
    expect(r.ok).toBe(true);
    expect(mocks.setTenantRole).toHaveBeenCalledOnce();
    expect(mocks.setTenantRole.mock.calls[0][0]).toMatchObject({ userId: "o1", remove: true });
  });

  it("allows removal of an admin even with a single owner", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "o1", role: "owner" }), member({ userId: "a1", role: "admin" })],
    });
    const r = await revokeMemberAction({ userId: "a1", email: "a1@example.com", status: "active" });
    expect(r.ok).toBe(true);
    expect(mocks.setTenantRole).toHaveBeenCalledOnce();
  });

  it("does not count invited owners toward the active-owner total", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [
        member({ userId: "o1", role: "owner", status: "active" }),
        member({ email: "pending@example.com", role: "owner", status: "invited" }),
      ],
    });
    const r = await revokeMemberAction({ userId: "o1", email: "o1@example.com", status: "active" });
    expect(r.ok).toBe(false);
    expect(mocks.setTenantRole).not.toHaveBeenCalled();
  });
});

describe("revokeMemberAction, invitation cancel path", () => {
  it("cancels a pending invitation by email (no roster lookup, no role strip)", async () => {
    const r = await revokeMemberAction({ userId: "", email: "pending@example.com", status: "invited" });
    expect(r.ok).toBe(true);
    expect(mocks.cancelInvitation).toHaveBeenCalledOnce();
    expect(mocks.cancelInvitation.mock.calls[0][0]).toMatchObject({ email: "pending@example.com" });
    expect(mocks.setTenantRole).not.toHaveBeenCalled();
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });
});
