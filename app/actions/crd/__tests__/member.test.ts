// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for revokeMemberAction and leaveTenantAction (Removal,
 * ADR-0093 §11, hosted#205).
 *
 * revokeMemberAction calls the daemon's MembershipService.RemoveMember for
 * active members (which revokes every session at once and deletes the
 * Zitadel account) and CancelInvitation for pending invitations, running an
 * Owner pre-check against the daemon roster (listMembersAction) before any
 * mutation. leaveTenantAction is the self-service half: it calls
 * MembershipService.LeaveTenant with no target, the caller removes
 * themselves.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMembers: vi.fn(),
  removeMember: vi.fn(async (_req: Record<string, unknown>) => ({})),
  leaveTenant: vi.fn(async (_req: Record<string, unknown>) => ({})),
  cancelInvitation: vi.fn(async (_req: Record<string, unknown>) => ({})),
  requireCrdSession: vi.fn(),
}));

vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: mocks.listMembers,
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({
    removeMember: mocks.removeMember,
    leaveTenant: mocks.leaveTenant,
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

import { revokeMemberAction, leaveTenantAction } from "../member";

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
  mocks.removeMember.mockReset();
  mocks.removeMember.mockResolvedValue({});
  mocks.leaveTenant.mockReset();
  mocks.leaveTenant.mockResolvedValue({});
  mocks.cancelInvitation.mockReset();
  mocks.cancelInvitation.mockResolvedValue({});
  // Authz gate: allow.
  mocks.requireCrdSession.mockResolvedValue({
    ok: true,
    session: { user: { id: "caller" } },
    userId: "caller",
  });
});

describe("revokeMemberAction, Owner pre-check", () => {
  it("blocks removal of the Owner (no mutation)", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "o1", role: "owner" })],
    });
    const r = await revokeMemberAction({ userId: "o1", email: "o1@example.com", status: "active" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect((r as { error: string }).error).toMatch(/owner/i);
    expect(mocks.removeMember).not.toHaveBeenCalled();
  });

  it("allows removal of an admin", async () => {
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [member({ userId: "o1", role: "owner" }), member({ userId: "a1", role: "admin" })],
    });
    const r = await revokeMemberAction({ userId: "a1", email: "a1@example.com", status: "active" });
    expect(r.ok).toBe(true);
    expect(mocks.removeMember).toHaveBeenCalledOnce();
    expect(mocks.removeMember.mock.calls[0][0]).toMatchObject({ userId: "a1", tenantId: "acme" });
  });

  it("falls back to the daemon's own PermissionDenied mapping when the roster lookup misses the target", async () => {
    mocks.listMembers.mockResolvedValue({ ok: true, data: [] });
    mocks.removeMember.mockRejectedValue(
      new ConnectError("the tenant's Owner cannot be removed", Code.PermissionDenied),
    );
    const r = await revokeMemberAction({ userId: "o1", email: "o1@example.com", status: "active" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect((r as { error: string }).error).toMatch(/owner/i);
    expect((r as { error: string }).error).not.toMatch(/cannot be removed/); // fixed message, not the raw daemon text
  });
});

describe("revokeMemberAction, invitation cancel path", () => {
  it("cancels a pending invitation by email (no roster lookup, no removal RPC)", async () => {
    const r = await revokeMemberAction({ userId: "", email: "pending@example.com", status: "invited" });
    expect(r.ok).toBe(true);
    expect(mocks.cancelInvitation).toHaveBeenCalledOnce();
    expect(mocks.cancelInvitation.mock.calls[0][0]).toMatchObject({ email: "pending@example.com" });
    expect(mocks.removeMember).not.toHaveBeenCalled();
    expect(mocks.listMembers).not.toHaveBeenCalled();
  });
});

describe("leaveTenantAction", () => {
  it("calls LeaveTenant with no target (the caller removes themselves)", async () => {
    const r = await leaveTenantAction();
    expect(r.ok).toBe(true);
    expect(mocks.leaveTenant).toHaveBeenCalledOnce();
    expect(mocks.leaveTenant.mock.calls[0][0]).toMatchObject({ tenantId: "acme" });
  });

  it("maps the daemon's Owner refusal to a fixed, clear message", async () => {
    mocks.leaveTenant.mockRejectedValue(
      new ConnectError("the tenant's Owner cannot leave", Code.PermissionDenied),
    );
    const r = await leaveTenantAction();
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect((r as { error: string }).error).toMatch(/transfer ownership/i);
  });

  it("returns FORBIDDEN when the session gate denies", async () => {
    mocks.requireCrdSession.mockResolvedValue({
      ok: false,
      result: { ok: false, error: "denied", code: "FORBIDDEN" },
    });
    const r = await leaveTenantAction();
    expect(r.ok).toBe(false);
    expect(mocks.leaveTenant).not.toHaveBeenCalled();
  });
});
