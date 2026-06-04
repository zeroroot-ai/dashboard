/**
 * Tests for transferOwnershipAction (dashboard#716).
 *
 * Post-cutover the action validates the target against the daemon roster
 * (listMembersAction → MemberRow) and performs the ownership swap via
 * MembershipService.TransferOwnership. The former TenantMember.spec.role
 * display-cache patches were removed.
 *
 * Scenarios: happy path, caller lacks gate → FORBIDDEN, target not found /
 * already owner / not-active-admin → BAD_INPUT, RPC throws → INTERNAL.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

const mocks = vi.hoisted(() => ({
  transferOwnership: vi.fn(async (_req: Record<string, unknown>) => ({})),
  listMembers: vi.fn(),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/src/lib/gibson-client", () => ({
  serviceClient: vi.fn(() => ({})),
  userClient: vi.fn(() => ({ transferOwnership: mocks.transferOwnership })),
}));

vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: mocks.listMembers,
}));

vi.mock("@/src/lib/auth/schema", () => ({ isCrossTenant: vi.fn(() => false) }));

vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return {
    ...actual,
    requireActiveTenant: vi.fn(async () => "acme"),
    getActiveTenant: vi.fn(async () => "acme"),
  };
});

vi.mock("@/src/lib/audit/crd", () => ({
  emitCrdAudit: vi.fn(),
  emitCrdAuditFromGate: vi.fn(),
}));

import { getServerSession } from "@/src/lib/auth";
import { transferOwnershipAction } from "../transfer-ownership";

const sessionMock = getServerSession as Mock;

function memberRow(over: { userId: string; role: string; status?: string }) {
  return {
    userId: over.userId,
    displayName: "",
    email: `${over.userId}@example.com`,
    role: over.role,
    joinedAt: "",
    status: over.status ?? "active",
  };
}

const CALLER = memberRow({ userId: "user-caller", role: "owner" });
const ACTIVE_ADMIN_TARGET = memberRow({ userId: "user-target", role: "admin" });

function withSession(opts: { role?: string } = {}) {
  const role = opts.role ?? "owner";
  sessionMock.mockResolvedValue({
    user: {
      id: "user-caller",
      name: "Caller",
      email: "caller@example.com",
      emailVerified: true,
      tenantId: "acme",
      tenants: ["acme"],
      rolesByTenant: { acme: role },
      roles: [role],
      groups: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  });
}

beforeEach(() => {
  mocks.transferOwnership.mockClear();
  mocks.transferOwnership.mockResolvedValue({});
  mocks.listMembers.mockReset();
  mocks.listMembers.mockResolvedValue({ ok: true, data: [CALLER, ACTIVE_ADMIN_TARGET] });
  sessionMock.mockReset();
});

describe("transferOwnershipAction — happy path", () => {
  it("transfers ownership to an active admin and returns {ok: true}", async () => {
    withSession();
    expect(await transferOwnershipAction("user-target")).toEqual({ ok: true, data: { applied: true } });
  });

  it("issues exactly one transferOwnership RPC with tenantId + newOwnerUserId", async () => {
    withSession();
    await transferOwnershipAction("user-target");
    expect(mocks.transferOwnership).toHaveBeenCalledOnce();
    expect(mocks.transferOwnership.mock.calls[0][0]).toMatchObject({
      tenantId: "acme",
      newOwnerUserId: "user-target",
    });
  });
});

describe("transferOwnershipAction — caller lacks permission", () => {
  it("returns FORBIDDEN and does not call the RPC", async () => {
    withSession({ role: "member" });
    const r = await transferOwnershipAction("user-target");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });
});

describe("transferOwnershipAction — target validation", () => {
  it("BAD_INPUT when the target is not in the roster", async () => {
    withSession();
    mocks.listMembers.mockResolvedValue({ ok: true, data: [CALLER] });
    const r = await transferOwnershipAction("user-nobody");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("BAD_INPUT");
      expect(r.error).toContain("not found");
    }
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("BAD_INPUT for an empty newOwnerUserId", async () => {
    withSession();
    const r = await transferOwnershipAction("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BAD_INPUT");
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("BAD_INPUT when the target is already an owner", async () => {
    withSession();
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [CALLER, memberRow({ userId: "user-target", role: "owner" })],
    });
    const r = await transferOwnershipAction("user-target");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("already an owner");
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("BAD_INPUT when the target is a member, not an admin", async () => {
    withSession();
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [CALLER, memberRow({ userId: "user-target", role: "member" })],
    });
    const r = await transferOwnershipAction("user-target");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Active admin");
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });

  it("BAD_INPUT when the target is an admin but not active (invited)", async () => {
    withSession();
    mocks.listMembers.mockResolvedValue({
      ok: true,
      data: [CALLER, memberRow({ userId: "user-target", role: "admin", status: "invited" })],
    });
    const r = await transferOwnershipAction("user-target");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BAD_INPUT");
    expect(mocks.transferOwnership).not.toHaveBeenCalled();
  });
});

describe("transferOwnershipAction — RPC throws", () => {
  it("returns INTERNAL when transferOwnership rejects", async () => {
    withSession();
    mocks.transferOwnership.mockRejectedValueOnce(new Error("daemon unavailable"));
    const r = await transferOwnershipAction("user-target");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INTERNAL");
  });
});
