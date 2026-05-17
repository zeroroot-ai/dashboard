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

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

const writeAccessTuplesMock = vi.fn(async () => ({}));
vi.mock("@/src/lib/gibson-client", () => ({
  serviceClient: vi.fn(() => ({ writeAccessTuples: writeAccessTuplesMock })),
}));

// hasPermission lives in src/lib/auth/schema; the action surface calls into
// it via requireCrdSession. Stub to return true so the action progresses to
// the FGA write; gating is exercised separately in authz.test.ts.
vi.mock("@/src/lib/auth/schema", () => ({
  hasPermission: vi.fn(() => true),
  isCrossTenant: vi.fn(() => false),
  loadSchema: vi.fn(async () => ({
    schemaVersion: "",
    roles: [],
    permissions: [],
    rpcRequirements: {},
  })),
  resolveEffectivePermissions: vi.fn(async () => []),
  resolveCrossTenant: vi.fn(async () => false),
}));

vi.mock("@/src/lib/audit/crd", () => ({
  emitCrdAuditFromGate: vi.fn(),
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
      rolesByTenant: { [tenantId]: "tenant_admin" },
      roles: ["tenant_admin"],
      groups: [],
      permissions: ["members:invite", "members:revoke"],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeEach(() => {
  writeAccessTuplesMock.mockClear();
  sessionMock.mockReset();
});

describe("setTenantRoleAction", () => {
  it("admin → member writes member + deletes admin in a single call", async () => {
    withSession("acme");
    const r = await setTenantRoleAction({ userId: "alice", role: "member" });
    expect(r).toEqual({ ok: true, data: { applied: true } });
    expect(writeAccessTuplesMock).toHaveBeenCalledOnce();
    const [payload] = writeAccessTuplesMock.mock.calls[0] as unknown as [
      { add: unknown[]; delete: unknown[]; reason: string },
    ];
    expect(payload.add).toEqual([
      { user: "user:alice", relation: "member", object: "tenant:acme" },
    ]);
    expect(payload.delete).toEqual([
      { user: "user:alice", relation: "admin", object: "tenant:acme" },
    ]);
    expect(payload.reason).toContain("alice");
    expect(payload.reason).toContain("member");
  });

  it("member → admin writes admin + deletes member in a single call", async () => {
    withSession("acme");
    await setTenantRoleAction({ userId: "alice", role: "admin" });
    const [payload] = writeAccessTuplesMock.mock.calls[0] as unknown as [
      { add: unknown[]; delete: unknown[] },
    ];
    expect(payload.add).toEqual([
      { user: "user:alice", relation: "admin", object: "tenant:acme" },
    ]);
    expect(payload.delete).toEqual([
      { user: "user:alice", relation: "member", object: "tenant:acme" },
    ]);
  });

  it("rejects an empty userId before calling the daemon", async () => {
    withSession("acme");
    const r = await setTenantRoleAction({ userId: "", role: "admin" });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("BAD_INPUT");
    expect(writeAccessTuplesMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid role before calling the daemon", async () => {
    withSession("acme");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await setTenantRoleAction({ userId: "alice", role: "owner" as any });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("BAD_INPUT");
    expect(writeAccessTuplesMock).not.toHaveBeenCalled();
  });
});

describe("setTeamAdminAction", () => {
  it("isAdmin=true adds the admin tuple, does NOT touch member", async () => {
    withSession("acme");
    const r = await setTeamAdminAction({
      teamId: "red",
      userId: "alice",
      isAdmin: true,
    });
    expect(r).toEqual({ ok: true, data: { applied: true } });
    const [payload] = writeAccessTuplesMock.mock.calls[0] as unknown as [
      { add: unknown[]; delete: unknown[]; reason: string },
    ];
    expect(payload.add).toEqual([
      { user: "user:alice", relation: "admin", object: "team:red" },
    ]);
    expect(payload.delete).toEqual([]);
    expect(payload.reason).toContain("promote");
  });

  it("isAdmin=false deletes the admin tuple, leaves member intact", async () => {
    withSession("acme");
    await setTeamAdminAction({
      teamId: "red",
      userId: "alice",
      isAdmin: false,
    });
    const [payload] = writeAccessTuplesMock.mock.calls[0] as unknown as [
      { add: unknown[]; delete: unknown[]; reason: string },
    ];
    expect(payload.add).toEqual([]);
    expect(payload.delete).toEqual([
      { user: "user:alice", relation: "admin", object: "team:red" },
    ]);
    expect(payload.reason).toContain("demote");
    // Crucial: member relation must NOT appear in either add or delete —
    // this is the whole reason setTeamAdminAction exists vs. the dance.
    const allTuples = [...payload.add, ...payload.delete] as Array<{
      relation: string;
    }>;
    expect(allTuples.every((t) => t.relation !== "member")).toBe(true);
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
    expect(writeAccessTuplesMock).not.toHaveBeenCalled();
  });
});
