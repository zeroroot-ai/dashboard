/**
 * Tests for the orphan-user-cleanup admin provisioning handlers:
 *   - handleListMembers
 *   - handleListUserOrganizations
 *   - handleDeleteUser
 *
 * The dashboard's vitest harness has no live Better Auth + Postgres fixture,
 * so these tests mock @/src/lib/auth-server and @/src/lib/spiffe-verifier.
 * The aim is to lock in the SPIFFE auth boundary, request validation, and —
 * critically — the 409 defense-in-depth invariant on handleDeleteUser.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ----- Mocks (vi.hoisted lets factories share the spies) -----

const mocks = vi.hoisted(() => ({
  verifySpiffeBearer: vi.fn(),
  internalAdapter: {
    findUserById: vi.fn(),
    deleteUser: vi.fn(),
  },
  orgAdapter: {
    findOrganizationById: vi.fn(),
    listMembers: vi.fn(),
    listOrganizations: vi.fn(),
  },
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

const { verifySpiffeBearer, internalAdapter, orgAdapter } = mocks;

// Imported AFTER the mocks above are wired.
import {
  handleListMembers,
  handleListUserOrganizations,
  handleDeleteUser,
} from "./admin-provisioning";

// ----- Helpers -----

function makeReq(body: unknown, authHeader = "Bearer test-svid"): NextRequest {
  return {
    headers: { get: (k: string) => (k === "authorization" ? authHeader : null) },
    json: async () => body,
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifySpiffeBearer.mockResolvedValue({ spiffeId: "spiffe://test/operator" });
});

// ----- handleListMembers -----

describe("handleListMembers", () => {
  it("returns 401 when SPIFFE verification fails", async () => {
    verifySpiffeBearer.mockRejectedValue(new Error("bad svid"));
    const res = await handleListMembers(makeReq({ organizationId: "org_a" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when organizationId missing", async () => {
    const res = await handleListMembers(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when org not found", async () => {
    orgAdapter.findOrganizationById.mockResolvedValue(null);
    const res = await handleListMembers(makeReq({ organizationId: "org_a" }));
    expect(res.status).toBe(404);
  });

  it("returns members on success (handles {members} shape)", async () => {
    orgAdapter.findOrganizationById.mockResolvedValue({ id: "org_a" });
    orgAdapter.listMembers.mockResolvedValue({
      members: [
        { userId: "u1", role: "admin" },
        { userId: "u2", role: "member" },
      ],
      total: 2,
    });
    const res = await handleListMembers(makeReq({ organizationId: "org_a" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toEqual([
      { userId: "u1", role: "admin" },
      { userId: "u2", role: "member" },
    ]);
  });

  it("returns members on success (handles bare-array shape)", async () => {
    orgAdapter.findOrganizationById.mockResolvedValue({ id: "org_a" });
    orgAdapter.listMembers.mockResolvedValue([
      { userId: "u1", role: "admin" },
    ]);
    const res = await handleListMembers(makeReq({ organizationId: "org_a" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toEqual([{ userId: "u1", role: "admin" }]);
  });
});

// ----- handleListUserOrganizations -----

describe("handleListUserOrganizations", () => {
  it("returns 401 when SPIFFE verification fails", async () => {
    verifySpiffeBearer.mockRejectedValue(new Error("bad svid"));
    const res = await handleListUserOrganizations(makeReq({ userId: "u1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when userId missing", async () => {
    const res = await handleListUserOrganizations(makeReq({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when user not found", async () => {
    internalAdapter.findUserById.mockResolvedValue(null);
    const res = await handleListUserOrganizations(makeReq({ userId: "ghost" }));
    expect(res.status).toBe(404);
  });

  it("returns ONLY org IDs (no metadata)", async () => {
    internalAdapter.findUserById.mockResolvedValue({ id: "u1" });
    orgAdapter.listOrganizations.mockResolvedValue([
      { id: "org_a", name: "Acme", metadata: { secret: "1" } },
      { id: "org_b", name: "Beta" },
    ]);
    const res = await handleListUserOrganizations(makeReq({ userId: "u1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ organizationIds: ["org_a", "org_b"] });
    // explicitly assert PII has not leaked
    expect(JSON.stringify(body)).not.toContain("Acme");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

// ----- handleDeleteUser -----

describe("handleDeleteUser", () => {
  it("returns 401 when SPIFFE verification fails", async () => {
    verifySpiffeBearer.mockRejectedValue(new Error("bad svid"));
    const res = await handleDeleteUser(makeReq({ userId: "u1" }));
    expect(res.status).toBe(401);
    expect(internalAdapter.deleteUser).not.toHaveBeenCalled();
  });

  it("returns 400 when userId missing", async () => {
    const res = await handleDeleteUser(makeReq({}));
    expect(res.status).toBe(400);
    expect(internalAdapter.deleteUser).not.toHaveBeenCalled();
  });

  it("returns 404 when user not found", async () => {
    internalAdapter.findUserById.mockResolvedValue(null);
    const res = await handleDeleteUser(makeReq({ userId: "ghost" }));
    expect(res.status).toBe(404);
    expect(internalAdapter.deleteUser).not.toHaveBeenCalled();
  });

  // ⚠️ CORE INVARIANT: a non-orphan user MUST yield 409 and MUST NOT be
  // deleted, regardless of what the caller's own count claimed. This guards
  // against a buggy operator wiping users that still belong elsewhere.
  it("returns 409 when user still has memberships and does NOT delete", async () => {
    internalAdapter.findUserById.mockResolvedValue({ id: "u1" });
    orgAdapter.listOrganizations.mockResolvedValue([
      { id: "org_other_1" },
      { id: "org_other_2" },
    ]);
    const res = await handleDeleteUser(makeReq({ userId: "u1" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.remainingOrgCount).toBe(2);
    expect(internalAdapter.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the user and returns 200 when org count is zero", async () => {
    internalAdapter.findUserById.mockResolvedValue({ id: "u1" });
    orgAdapter.listOrganizations.mockResolvedValue([]);
    internalAdapter.deleteUser.mockResolvedValue(undefined);
    const res = await handleDeleteUser(makeReq({ userId: "u1" }));
    expect(res.status).toBe(200);
    expect(internalAdapter.deleteUser).toHaveBeenCalledWith("u1");
  });
});
