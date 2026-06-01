/**
 * Tests for transferOwnershipAction.
 *
 * Covers the six contract scenarios:
 *   1. Valid input, caller is owner, target is active admin → {ok: true}
 *   2. Caller lacks the gate permission → FORBIDDEN
 *   3. Target user not found → BAD_INPUT
 *   4. Target is already an owner → BAD_INPUT
 *   5. Target is a member (not admin) → BAD_INPUT
 *   6. FGA write throws → INTERNAL
 *
 * Authz gating is exercised by the broader matrix in authz.test.ts; this
 * file is the targeted unit test for the action's own validation logic and
 * FGA wire-shape. dashboard#266.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// vi.mock factories are hoisted above top-level `const` decls; hoist mock
// handles via vi.hoisted so the factories below can close over them.
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
    transferOwnership: mocks.writeAccessTuples,
  })),
}));

vi.mock("@/src/lib/auth/schema", () => ({
  isCrossTenant: vi.fn(() => false),
}));

// The gate + action resolve the active tenant via requireActiveTenant()
// (next/headers cookies, no request scope under vitest). Pin it to "acme" so
// the tenant-scope check is deterministic.
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
  emitCrdAudit: vi.fn(),
  emitCrdAuditFromGate: vi.fn(),
}));

vi.mock("@/src/lib/k8s/tenants", () => ({
  listTenantMembers: mocks.listTenantMembers,
  patchTenantMember: mocks.patchTenantMember,
}));

vi.mock("@/src/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getServerSession } from "@/src/lib/auth";
import { transferOwnershipAction } from "../transfer-ownership";

const sessionMock = getServerSession as Mock;

/** An active admin TenantMember fixture for the target user. */
const ACTIVE_ADMIN_TARGET = {
  metadata: { name: "member-target" },
  spec: { email: "target@example.com", role: "admin" },
  status: { userId: "user-target", phase: "Active" },
};

/** An active owner TenantMember fixture for the caller. */
const ACTIVE_OWNER_CALLER = {
  metadata: { name: "member-caller" },
  spec: { email: "caller@example.com", role: "owner" },
  status: { userId: "user-caller", phase: "Active" },
};

// `role` is the caller's active-tenant role; the gate authorizes it against
// the action's required relation (admin). Defaults to "owner" (allowed); pass
// "member" to model an under-privileged caller.
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
  mocks.writeAccessTuples.mockClear();
  mocks.listTenantMembers.mockReset();
  mocks.listTenantMembers.mockResolvedValue([ACTIVE_OWNER_CALLER, ACTIVE_ADMIN_TARGET]);
  mocks.patchTenantMember.mockReset();
  mocks.patchTenantMember.mockResolvedValue({});
  sessionMock.mockReset();
});

// ── Scenario 1 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — happy path", () => {
  it("transfers owner to an active admin and returns {ok: true, data: {applied: true}}", async () => {
    withSession();

    const result = await transferOwnershipAction("user-target");

    expect(result).toEqual({ ok: true, data: { applied: true } });
  });

  it("issues exactly one transferOwnership call with the correct tenantId and newOwnerUserId", async () => {
    withSession();

    await transferOwnershipAction("user-target");

    expect(mocks.writeAccessTuples).toHaveBeenCalledOnce();
    const [payload] = mocks.writeAccessTuples.mock.calls[0] as unknown as [
      { tenantId: string; newOwnerUserId: string },
    ];

    expect(payload.tenantId).toBe("acme");
    expect(payload.newOwnerUserId).toBe("user-target");
  });

  it("patches both TenantMember CRs for the display-cache update", async () => {
    withSession();

    await transferOwnershipAction("user-target");

    expect(mocks.patchTenantMember).toHaveBeenCalledTimes(2);

    const calls = mocks.patchTenantMember.mock.calls as unknown as [string, string, { spec: { role: string } }][];
    const newOwnerPatch = calls.find(([, name]) => name === "member-target");
    const oldOwnerPatch = calls.find(([, name]) => name === "member-caller");

    expect(newOwnerPatch?.[2].spec.role).toBe("owner");
    expect(oldOwnerPatch?.[2].spec.role).toBe("admin");
  });
});

// ── Scenario 2 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — caller lacks permission", () => {
  it("returns FORBIDDEN when the caller's role does not satisfy admin", async () => {
    withSession({ role: "member" });

    const result = await transferOwnershipAction("user-target");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("FORBIDDEN");
    }
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });
});

// ── Scenario 3 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — target not found", () => {
  it("returns BAD_INPUT when the target userId is not in the tenant members list", async () => {
    withSession();
    mocks.listTenantMembers.mockResolvedValue([ACTIVE_OWNER_CALLER]);

    const result = await transferOwnershipAction("user-nobody");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BAD_INPUT");
      expect(result.error).toContain("not found");
    }
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });

  it("returns BAD_INPUT for an empty newOwnerUserId before any auth gate", async () => {
    withSession();

    const result = await transferOwnershipAction("");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BAD_INPUT");
    }
    // Should fail before writing.
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });
});

// ── Scenario 4 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — target is already an owner", () => {
  it("returns BAD_INPUT when the target has spec.role === 'owner'", async () => {
    withSession();
    mocks.listTenantMembers.mockResolvedValue([
      ACTIVE_OWNER_CALLER,
      {
        metadata: { name: "member-target" },
        spec: { email: "target@example.com", role: "owner" },
        status: { userId: "user-target", phase: "Active" },
      },
    ]);

    const result = await transferOwnershipAction("user-target");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BAD_INPUT");
      expect(result.error).toContain("already an owner");
    }
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });
});

// ── Scenario 5 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — target is a member, not an admin", () => {
  it("returns BAD_INPUT when spec.role === 'member'", async () => {
    withSession();
    mocks.listTenantMembers.mockResolvedValue([
      ACTIVE_OWNER_CALLER,
      {
        metadata: { name: "member-target" },
        spec: { email: "target@example.com", role: "member" },
        status: { userId: "user-target", phase: "Active" },
      },
    ]);

    const result = await transferOwnershipAction("user-target");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BAD_INPUT");
      expect(result.error).toContain("Active admin");
    }
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });

  it("returns BAD_INPUT when the target is an admin but not Active (e.g. Invited)", async () => {
    withSession();
    mocks.listTenantMembers.mockResolvedValue([
      ACTIVE_OWNER_CALLER,
      {
        metadata: { name: "member-target" },
        spec: { email: "target@example.com", role: "admin" },
        status: { userId: "user-target", phase: "Invited" },
      },
    ]);

    const result = await transferOwnershipAction("user-target");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("BAD_INPUT");
    }
    expect(mocks.writeAccessTuples).not.toHaveBeenCalled();
  });
});

// ── Scenario 6 ──────────────────────────────────────────────────────────────

describe("transferOwnershipAction — FGA write throws", () => {
  it("returns INTERNAL and does NOT patch any TenantMember when writeAccessTuples rejects", async () => {
    withSession();
    mocks.writeAccessTuples.mockRejectedValueOnce(new Error("FGA unavailable"));

    const result = await transferOwnershipAction("user-target");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("INTERNAL");
    }
    // Critical: display-cache patches must NOT run if FGA failed.
    expect(mocks.patchTenantMember).not.toHaveBeenCalled();
  });
});

// ── Display-cache resilience ─────────────────────────────────────────────────

describe("transferOwnershipAction — display-cache patch failures are swallowed", () => {
  it("returns {ok: true} even when patchTenantMember rejects for either member", async () => {
    withSession();
    mocks.patchTenantMember.mockRejectedValue(new Error("k8s 409 Conflict"));

    const result = await transferOwnershipAction("user-target");

    // FGA write succeeded; the action must still return ok.
    expect(result).toEqual({ ok: true, data: { applied: true } });
    expect(mocks.writeAccessTuples).toHaveBeenCalledOnce();
  });
});
