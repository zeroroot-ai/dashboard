/**
 * @vitest-environment node
 *
 * Tests for the slug-collision idempotency / ownership enforcement logic in
 * handleCreate (admin-provisioning.ts Task 19).
 *
 * Four scenarios:
 *   1. Same slug + same owner  → idempotent 200, no duplicate member row.
 *   2. Same slug + diff owner  → 409 SLUG_OWNED_BY_OTHER_USER, no new member.
 *   3. New slug               → org created, owner membership added (happy path).
 *   4. Audit events emitted correctly for all three.
 *
 * The test file mocks three external boundaries:
 *   - @/src/lib/spiffe-verifier  (SPIFFE auth gate)
 *   - @/src/lib/auth-server      (Better Auth context with internalAdapter)
 *   - better-auth/plugins/organization (getOrgAdapter)
 *   - @/src/lib/audit/auth       (emitAuthAudit — verified via spy)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Hoist shared spy/mock state so vi.mock factories can close over it.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  verifySpiffeBearer: vi.fn(),
  internalAdapter: {
    findUserById: vi.fn(),
    findUserByEmail: vi.fn(),
    createUser: vi.fn(),
  },
  orgAdapter: {
    findOrganizationBySlug: vi.fn(),
    createOrganization: vi.fn(),
    createMember: vi.fn(),
    listMembers: vi.fn(),
  },
  emitAuthAudit: vi.fn(),
}));

vi.mock("@/src/lib/spiffe-verifier", () => ({
  verifySpiffeBearer: (h: string | null) => mocks.verifySpiffeBearer(h),
}));

vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({
      internalAdapter: mocks.internalAdapter,
    }),
  },
}));

vi.mock("better-auth/plugins/organization", () => ({
  getOrgAdapter: () => mocks.orgAdapter,
}));

vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: (...args: unknown[]) => mocks.emitAuthAudit(...args),
}));

// Imported AFTER mocks are wired.
import { handleCreate } from "../admin-provisioning";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NextRequest stub for handleCreate. */
function makeReq(
  body: Record<string, unknown>,
  authHeader = "Bearer test-svid",
): NextRequest {
  return {
    headers: { get: (k: string) => (k === "authorization" ? authHeader : null) },
    json: async () => body,
  } as unknown as NextRequest;
}

const EXISTING_ORG_ID = "org_existing_001";
const EXISTING_OWNER_USER_ID = "user_owner_001";
const OTHER_USER_ID = "user_other_002";

/** Configure mocks so the slug already exists with EXISTING_OWNER_USER_ID as owner. */
function setupExistingSlug() {
  mocks.orgAdapter.findOrganizationBySlug.mockResolvedValue({
    id: EXISTING_ORG_ID,
    slug: "acme-corp",
  });
  mocks.orgAdapter.listMembers.mockResolvedValue([
    { id: "member_001", userId: EXISTING_OWNER_USER_ID, role: "owner" },
    { id: "member_002", userId: "user_member_003", role: "member" },
  ]);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // SPIFFE gate always passes by default.
  mocks.verifySpiffeBearer.mockResolvedValue({
    spiffeId: "spiffe://gibson.io/platform/tenant-operator",
  });
  // User lookups default to not-found; individual tests override as needed.
  mocks.internalAdapter.findUserById.mockResolvedValue(null);
  mocks.internalAdapter.findUserByEmail.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Scenario 1: Same slug + same owner → idempotent 200
// ---------------------------------------------------------------------------

describe("Scenario 1: same slug, same owner (idempotent replay)", () => {
  beforeEach(() => {
    setupExistingSlug();
    // Caller supplies ownerId that resolves to the existing owner.
    mocks.internalAdapter.findUserById.mockResolvedValue({
      id: EXISTING_OWNER_USER_ID,
    });
  });

  it("returns 200 with the existing org id", async () => {
    const res = await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: EXISTING_OWNER_USER_ID,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBe(EXISTING_ORG_ID);
  });

  it("does NOT call createOrganization", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: EXISTING_OWNER_USER_ID,
      }),
    );
    expect(mocks.orgAdapter.createOrganization).not.toHaveBeenCalled();
  });

  it("does NOT call createMember (no duplicate membership row)", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: EXISTING_OWNER_USER_ID,
      }),
    );
    expect(mocks.orgAdapter.createMember).not.toHaveBeenCalled();
  });

  it("emits org_created audit event with reason=idempotent_replay", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: EXISTING_OWNER_USER_ID,
      }),
    );
    expect(mocks.emitAuthAudit).toHaveBeenCalledOnce();
    const call = mocks.emitAuthAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(call.action).toBe("org_created");
    expect(call.outcome).toBe("ok");
    expect(call.reason).toBe("idempotent_replay");
    expect(call.userId).toBe(EXISTING_OWNER_USER_ID);
    expect(call.targetTenant).toBe("acme-corp");
  });

  it("also works when caller is identified by ownerEmail", async () => {
    // Reset findUserById to not-found; resolve via email instead.
    mocks.internalAdapter.findUserById.mockResolvedValue(null);
    mocks.internalAdapter.findUserByEmail.mockResolvedValue({
      user: { id: EXISTING_OWNER_USER_ID },
    });
    const res = await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerEmail: "owner@acme.com",
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBe(EXISTING_ORG_ID);
  });
});

// ---------------------------------------------------------------------------
// Scenario 2: Same slug + different owner → 409
// ---------------------------------------------------------------------------

describe("Scenario 2: same slug, different owner (conflict)", () => {
  beforeEach(() => {
    setupExistingSlug();
    // Caller is a different user than the existing org owner.
    mocks.internalAdapter.findUserById.mockResolvedValue({ id: OTHER_USER_ID });
  });

  it("returns 409", async () => {
    const res = await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    expect(res.status).toBe(409);
  });

  it("returns error code SLUG_OWNED_BY_OTHER_USER and existingOwnerRedacted=true", async () => {
    const res = await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("SLUG_OWNED_BY_OTHER_USER");
    expect(body.existingOwnerRedacted).toBe(true);
  });

  it("does NOT leak the existing owner's userId or email", async () => {
    const res = await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    const raw = await res.text();
    expect(raw).not.toContain(EXISTING_OWNER_USER_ID);
    // Re-parse to confirm no other fields slipped through.
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["error", "existingOwnerRedacted"].sort(),
    );
  });

  it("does NOT call createOrganization", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    expect(mocks.orgAdapter.createOrganization).not.toHaveBeenCalled();
  });

  it("does NOT call createMember on the existing org", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    expect(mocks.orgAdapter.createMember).not.toHaveBeenCalled();
  });

  it("emits signup_failed audit with reason=slug_owned_by_other", async () => {
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    expect(mocks.emitAuthAudit).toHaveBeenCalledOnce();
    const call = mocks.emitAuthAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(call.action).toBe("signup_failed");
    expect(call.outcome).toBe("failed");
    expect(call.reason).toBe("slug_owned_by_other");
    expect(call.userId).toBe(OTHER_USER_ID);
    expect(call.targetTenant).toBe("acme-corp");
  });

  it("uses userId='anonymous' in audit when caller cannot be resolved", async () => {
    // Caller supplies an ownerId that doesn't resolve.
    mocks.internalAdapter.findUserById.mockResolvedValue(null);
    await handleCreate(
      makeReq({
        name: "Acme Corp",
        slug: "acme-corp",
        ownerId: "nonexistent-user",
      }),
    );
    expect(res409AuditUserId()).toBe("anonymous");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3: New slug → happy path
// ---------------------------------------------------------------------------

describe("Scenario 3: new slug (happy path)", () => {
  const NEW_ORG_ID = "org_new_999";
  const NEW_OWNER_ID = "user_new_owner_777";

  beforeEach(() => {
    // Slug doesn't exist yet.
    mocks.orgAdapter.findOrganizationBySlug.mockResolvedValue(null);
    // Caller resolves successfully.
    mocks.internalAdapter.findUserById.mockResolvedValue({ id: NEW_OWNER_ID });
    // createOrganization returns a new org.
    mocks.orgAdapter.createOrganization.mockResolvedValue({ id: NEW_ORG_ID });
    // createMember succeeds.
    mocks.orgAdapter.createMember.mockResolvedValue({});
  });

  it("returns 200 with the new org id", async () => {
    const res = await handleCreate(
      makeReq({
        name: "New Tenant",
        slug: "new-tenant",
        ownerId: NEW_OWNER_ID,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id?: string };
    expect(body.id).toBe(NEW_ORG_ID);
  });

  it("calls createOrganization with name and slug", async () => {
    await handleCreate(
      makeReq({
        name: "New Tenant",
        slug: "new-tenant",
        ownerId: NEW_OWNER_ID,
      }),
    );
    expect(mocks.orgAdapter.createOrganization).toHaveBeenCalledOnce();
    const orgArg = mocks.orgAdapter.createOrganization.mock.calls[0][0] as {
      organization: { name: string; slug: string };
    };
    expect(orgArg.organization.name).toBe("New Tenant");
    expect(orgArg.organization.slug).toBe("new-tenant");
  });

  it("calls createMember with role=owner for the resolved user", async () => {
    await handleCreate(
      makeReq({
        name: "New Tenant",
        slug: "new-tenant",
        ownerId: NEW_OWNER_ID,
      }),
    );
    expect(mocks.orgAdapter.createMember).toHaveBeenCalledOnce();
    const memberArg = mocks.orgAdapter.createMember.mock.calls[0][0] as {
      userId: string;
      organizationId: string;
      role: string;
    };
    expect(memberArg.userId).toBe(NEW_OWNER_ID);
    expect(memberArg.organizationId).toBe(NEW_ORG_ID);
    expect(memberArg.role).toBe("owner");
  });

  it("does NOT emit any audit event on the happy path", async () => {
    await handleCreate(
      makeReq({
        name: "New Tenant",
        slug: "new-tenant",
        ownerId: NEW_OWNER_ID,
      }),
    );
    // No audit is emitted for the plain new-org creation path.
    expect(mocks.emitAuthAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4: SPIFFE auth gate is preserved
// ---------------------------------------------------------------------------

describe("SPIFFE auth boundary", () => {
  it("returns 401 when verifySpiffeBearer rejects", async () => {
    mocks.verifySpiffeBearer.mockRejectedValue(new Error("invalid svid"));
    const res = await handleCreate(
      makeReq({ name: "X", slug: "x", ownerId: "u1" }),
    );
    expect(res.status).toBe(401);
    expect(mocks.orgAdapter.findOrganizationBySlug).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Audit event coverage across all scenarios (consolidated assertions)
// ---------------------------------------------------------------------------

describe("Audit event coverage", () => {
  it("idempotent replay emits org_created / ok / idempotent_replay", async () => {
    setupExistingSlug();
    mocks.internalAdapter.findUserById.mockResolvedValue({
      id: EXISTING_OWNER_USER_ID,
    });
    await handleCreate(
      makeReq({
        name: "Acme",
        slug: "acme-corp",
        ownerId: EXISTING_OWNER_USER_ID,
      }),
    );
    const ev = mocks.emitAuthAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(ev).toMatchObject({
      action: "org_created",
      outcome: "ok",
      reason: "idempotent_replay",
      targetTenant: "acme-corp",
      userId: EXISTING_OWNER_USER_ID,
    });
  });

  it("conflict emits signup_failed / failed / slug_owned_by_other", async () => {
    setupExistingSlug();
    mocks.internalAdapter.findUserById.mockResolvedValue({ id: OTHER_USER_ID });
    await handleCreate(
      makeReq({
        name: "Acme",
        slug: "acme-corp",
        ownerId: OTHER_USER_ID,
      }),
    );
    const ev = mocks.emitAuthAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(ev).toMatchObject({
      action: "signup_failed",
      outcome: "failed",
      reason: "slug_owned_by_other",
      targetTenant: "acme-corp",
      userId: OTHER_USER_ID,
    });
  });

  it("happy path emits no audit events", async () => {
    mocks.orgAdapter.findOrganizationBySlug.mockResolvedValue(null);
    mocks.internalAdapter.findUserById.mockResolvedValue({ id: "u99" });
    mocks.orgAdapter.createOrganization.mockResolvedValue({ id: "org_99" });
    mocks.orgAdapter.createMember.mockResolvedValue({});
    await handleCreate(
      makeReq({ name: "Fresh", slug: "fresh-slug", ownerId: "u99" }),
    );
    expect(mocks.emitAuthAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Local helper only used within Scenario 2 tests
// ---------------------------------------------------------------------------

/** Extract the userId from the first emitAuthAudit call (409 path). */
function res409AuditUserId(): string {
  const call = mocks.emitAuthAudit.mock.calls[0]?.[0] as
    | Record<string, unknown>
    | undefined;
  return String(call?.userId ?? "");
}
