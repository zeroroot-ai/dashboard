/**
 * Unit tests for the last-owner safeguard in revokeMemberAction.
 *
 * The guard runs a listTenantMembers call before any K8s mutation and blocks
 * removal when the target is the sole active owner. These tests cover the three
 * cases defined in dashboard#267.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// vi.hoisted so mock factories below can close over these without TDZ errors.
const mocks = vi.hoisted(() => ({
  listTenantMembers: vi.fn(async () => [] as unknown[]),
  deleteTenantMember: vi.fn(async () => undefined),
  patchTenantMember: vi.fn(async () => ({})),
  applyTenantMember: vi.fn(async () => ({})),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/src/lib/k8s/tenants", () => ({
  listTenantMembers: mocks.listTenantMembers,
  deleteTenantMember: mocks.deleteTenantMember,
  patchTenantMember: mocks.patchTenantMember,
  applyTenantMember: mocks.applyTenantMember,
  tenantNamespace: (name: string) => `tenant-${name}`,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../_rate_limits", () => ({
  CRD_RATE_LIMITS: {},
  consumeRateLimit: vi.fn(async () => ({ ok: true })),
}));

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

vi.mock("@/src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getServerSession } from "@/src/lib/auth";
import { revokeMemberAction } from "../member";

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
      permissions: ["members:revoke"],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

/** Build a minimal TenantMember fixture. */
function makeMember(overrides: {
  name: string;
  role: "owner" | "admin" | "member";
  phase?: string;
}) {
  return {
    metadata: { name: overrides.name },
    spec: { email: `${overrides.name}@example.com`, role: overrides.role },
    status: { userId: overrides.name, phase: overrides.phase ?? "Active" },
  };
}

beforeEach(() => {
  mocks.listTenantMembers.mockReset();
  mocks.deleteTenantMember.mockReset();
  mocks.deleteTenantMember.mockResolvedValue(undefined);
  sessionMock.mockReset();
});

describe("revokeMemberAction — last-owner safeguard", () => {
  it("(1) blocks removal of the last active owner", async () => {
    withSession("acme");
    const owner = makeMember({ name: "invite-owner", role: "owner" });
    mocks.listTenantMembers.mockResolvedValue([owner]);

    const result = await revokeMemberAction("acme", "invite-owner");

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("FORBIDDEN");
    expect((result as { error: string }).error).toMatch(/last owner/i);
    // K8s delete must NOT have been called.
    expect(mocks.deleteTenantMember).not.toHaveBeenCalled();
  });

  it("(2) allows removal when two active owners exist", async () => {
    withSession("acme");
    const owner1 = makeMember({ name: "invite-owner1", role: "owner" });
    const owner2 = makeMember({ name: "invite-owner2", role: "owner" });
    mocks.listTenantMembers.mockResolvedValue([owner1, owner2]);

    const result = await revokeMemberAction("acme", "invite-owner1");

    expect(result.ok).toBe(true);
    expect(mocks.deleteTenantMember).toHaveBeenCalledOnce();
  });

  it("(3) allows removal of an active admin even when only one active owner exists", async () => {
    withSession("acme");
    const owner = makeMember({ name: "invite-owner", role: "owner" });
    const admin = makeMember({ name: "invite-admin", role: "admin" });
    mocks.listTenantMembers.mockResolvedValue([owner, admin]);

    const result = await revokeMemberAction("acme", "invite-admin");

    expect(result.ok).toBe(true);
    expect(mocks.deleteTenantMember).toHaveBeenCalledOnce();
  });

  it("does not count inactive (non-Active) owners toward the active-owner total", async () => {
    withSession("acme");
    // One active owner + one revoked owner; target is the active one → blocked.
    const activeOwner = makeMember({ name: "invite-owner-active", role: "owner", phase: "Active" });
    const revokedOwner = makeMember({ name: "invite-owner-revoked", role: "owner", phase: "Revoked" });
    mocks.listTenantMembers.mockResolvedValue([activeOwner, revokedOwner]);

    const result = await revokeMemberAction("acme", "invite-owner-active");

    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe("FORBIDDEN");
    expect(mocks.deleteTenantMember).not.toHaveBeenCalled();
  });
});
