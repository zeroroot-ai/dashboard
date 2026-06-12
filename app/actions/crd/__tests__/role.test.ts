/**
 * Tests for the tenant-role + team-admin mutator server actions.
 *
 * Coverage focuses on the wire-shape contract: the right FGA tuples land in
 * the WriteAccessTuples payload (atomic add/delete pair for role flips, no
 * member-relation touch for team-admin toggle). Authz gating is exercised
 * by the broader matrix in authz.test.ts; this file is the targeted unit
 * test for the actions themselves. dashboard#168.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// vi.mock factories are hoisted above top-level `const` decls; hoist the
// mock-fn handles via vi.hoisted so the factories below can close over them
// without TDZ errors.
const mocks = vi.hoisted(() => ({
  writeAccessTuples: vi.fn(async () => ({})),
  listTenantMembers: vi.fn(async () => [] as unknown[]),
  patchTenantMember: vi.fn(async () => ({})),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/src/lib/gibson-client", () => ({
  serviceClient: vi.fn(() => ({ writeAccessTuples: mocks.writeAccessTuples })),
  userClient: vi.fn(() => ({
    setTenantRole: mocks.writeAccessTuples,
    setTeamAdmin: mocks.writeAccessTuples,
  })),
}));

// hasPermission lives in src/lib/auth/schema; the action surface calls into
// it via requireCrdSession. Stub to return true so the action progresses to
// the FGA write; gating is exercised separately in authz.test.ts.
vi.mock("@/src/lib/auth/schema", () => ({
  isCrossTenant: vi.fn(() => false),
}));

// Tenant-scope resolution reads next/headers cookies(), which has no request
// scope under vitest. Pin the active tenant to "acme".
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

// K8s mock for the dual-write side of setTenantRoleAction (dashboard#173).
vi.mock("@/src/lib/k8s/tenants", () => ({
  listTenantMembers: mocks.listTenantMembers,
  patchTenantMember: mocks.patchTenantMember,
}));

// Silence logger.warn during the dual-write fallback paths so test output
// stays clean; we assert behavior, not log lines.
vi.mock("@/src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getServerSession } from "@/src/lib/auth";
import { setTenantRoleAction, setTeamAdminAction } from "../role";

const sessionMock = getServerSession as Mock;

function withSession(tenantId: string) {
  sessionMock.mockResolvedValue({
    user: {
      id: "user-1",
      name: "Caller",
      email: "caller@example.com",
      emailVerified: true,
      tenantId,
      tenants: [tenantId],
      rolesByTenant: { [tenantId]: "admin" },
      roles: ["admin"],
      groups: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeEach(() => {
  mocks.writeAccessTuples.mockClear();
  mocks.listTenantMembers.mockReset();
  mocks.listTenantMembers.mockResolvedValue([]);
  mocks.patchTenantMember.mockReset();
  mocks.patchTenantMember.mockResolvedValue({});
  sessionMock.mockReset();
});

describe("setTenantRoleAction", () => {
  it("admin → member writes member role via setTenantRole", async () => {
    withSession("acme");
    const r = await setTenantRoleAction({ userId: "alice", role: "member" });
    expect(r).toEqual({ ok: true, data: { applied: true } });
    expect(mocks.writeAccessTuples).toHaveBeenCalledOnce();
    const [payload] = mocks.writeAccessTuples.mock.calls[0] as unknown as [
      { tenantId: string; userId: string; role: string; remove: boolean },
    ];
    expect(payload.tenantId).toBe("acme");
    expect(payload.userId).toBe("alice");
    expect(payload.role).toBe("member");
    expect(payload.remove).toBe(false);
  });

  it("member → admin writes admin role via setTenantRole", async () => {
    withSession("acme");
    await setTenantRoleAction({ userId: "alice", role: "admin" });
    const [payload] = mocks.writeAccessTuples.mock.calls[0] as unknown as [
      { tenantId: string; userId: string; role: string; remove: boolean },
    ];
    expect(payload.tenantId).toBe("acme");
    expect(payload.userId).toBe("alice");
    expect(payload.role).toBe("admin");
    expect(payload.remove).toBe(false);
  });

  it("rejects an empty userId before calling the daemon", async () => {
    withSession("acme");
    const r = await setTenantRoleAction({ userId: "", role: "admin" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("BAD_INPUT");
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });

  it("rejects an invalid role before calling the daemon", async () => {
    withSession("acme");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await setTenantRoleAction({ userId: "alice", role: "owner" as any });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("BAD_INPUT");
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Dual-write, dashboard#173
  // ---------------------------------------------------------------------------

  // dashboard#715 removed the TenantMember.spec.role display-cache patch:
  // ListMembers now derives role from FGA, so there is no CR to keep in sync.
  it("does not touch any TenantMember CR (no display-cache patch)", async () => {
    withSession("acme");
    const r = await setTenantRoleAction({ userId: "alice", role: "admin" });
    expect(r).toEqual({ ok: true, data: { applied: true } });
    expect(mocks.patchTenantMember).not.toHaveBeenCalled();
    expect(mocks.listTenantMembers).not.toHaveBeenCalled();
  });

  it("when the daemon write fails, returns INTERNAL and does not touch the CR", async () => {
    withSession("acme");
    mocks.writeAccessTuples.mockRejectedValueOnce(new Error("daemon unreachable"));
    const r = await setTenantRoleAction({ userId: "alice", role: "admin" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("INTERNAL");
    expect(mocks.patchTenantMember).not.toHaveBeenCalled();
  });
});

describe("setTeamAdminAction", () => {
  it("isAdmin=true promotes via setTeamAdmin", async () => {
    withSession("acme");
    const r = await setTeamAdminAction({
      teamId: "red",
      userId: "alice",
      isAdmin: true,
    });
    expect(r).toEqual({ ok: true, data: { applied: true } });
    const [payload] = mocks.writeAccessTuples.mock.calls[0] as unknown as [
      { tenantId: string; teamId: string; userId: string; isAdmin: boolean },
    ];
    expect(payload.tenantId).toBe("acme");
    expect(payload.teamId).toBe("red");
    expect(payload.userId).toBe("alice");
    expect(payload.isAdmin).toBe(true);
  });

  it("isAdmin=false demotes via setTeamAdmin", async () => {
    withSession("acme");
    await setTeamAdminAction({
      teamId: "red",
      userId: "alice",
      isAdmin: false,
    });
    const [payload] = mocks.writeAccessTuples.mock.calls[0] as unknown as [
      { tenantId: string; teamId: string; userId: string; isAdmin: boolean },
    ];
    expect(payload.tenantId).toBe("acme");
    expect(payload.teamId).toBe("red");
    expect(payload.userId).toBe("alice");
    expect(payload.isAdmin).toBe(false);
  });

  it("rejects empty teamId or userId before calling the daemon", async () => {
    withSession("acme");
    expect(
      (await setTeamAdminAction({ teamId: "", userId: "alice", isAdmin: true }))
        .ok,
    ).toBe(false);
    expect(
      (await setTeamAdminAction({ teamId: "red", userId: "", isAdmin: true }))
        .ok,
    ).toBe(false);
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });
});
