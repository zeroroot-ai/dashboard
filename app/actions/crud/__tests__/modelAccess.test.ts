/**
 * Unit tests for app/actions/crud/modelAccess.ts
 *
 * Focus: defense-in-depth authz mapping (dashboard#864 / #904). The per-RPC
 * authz check is baked into the userClient transport (dashboard#848 / #902),
 * so a denial is thrown from INSIDE the daemon RPC call as AuthzDeniedError.
 * The grant/revoke actions must map that denial to the canonical
 * "Permission denied" result via permissionDeniedResult.
 *
 * Mocks the gibson-client factory and the assert-authorized helper so the
 * tests run without a live gRPC connection. Mirrors app/actions/__tests__/
 * secrets.test.ts.
 *
 * Refs #864 / #818 / #904.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks, must precede subject import.
// ---------------------------------------------------------------------------

const {
  mockGrantAccess,
  mockRevokeAccess,
  mockGetModelAccessClient,
  mockGetServerSession,
  MockAuthzDeniedError,
} = vi.hoisted(() => {
  class _MockAuthzDeniedError extends Error {
    public readonly method: string;
    public readonly reason: string;
    constructor(method: string, reason: string) {
      super(`assertAuthorized: ${reason} for ${method}`);
      this.name = "AuthzDeniedError";
      this.method = method;
      this.reason = reason;
    }
  }
  const grantAccess = vi.fn(async () => ({}));
  const revokeAccess = vi.fn(async () => ({}));
  return {
    mockGrantAccess: grantAccess,
    mockRevokeAccess: revokeAccess,
    mockGetModelAccessClient: vi.fn(async () => ({
      grantAccess,
      revokeAccess,
    })),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
    MockAuthzDeniedError: _MockAuthzDeniedError,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/gibson-client", () => ({
  getModelAccessClient: mockGetModelAccessClient,
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/auth/assert-authorized", () => ({
  AuthzDeniedError: MockAuthzDeniedError,
  permissionDeniedResult: (err: unknown) =>
    err instanceof MockAuthzDeniedError
      ? {
          ok: false as const,
          error: "Permission denied",
          code: "permission_denied" as const,
        }
      : null,
}));

vi.mock("@/src/gen/gibson/tenant/v1/model_access_pb", () => ({
  GrantSubjectKind: { UNSPECIFIED: 0, USER: 1, TEAM: 2, TENANT: 3 },
  GrantTargetKind: { UNSPECIFIED: 0, PROVIDER: 1, MODEL: 2 },
}));

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import {
  grantModelAccessAction,
  revokeModelAccessAction,
  type GrantInput,
} from "../modelAccess";

const validInput: GrantInput = {
  subjectKind: "user",
  subjectId: "user-2",
  targetKind: "provider",
  targetId: "anthropic",
};

// ---------------------------------------------------------------------------
// grantModelAccessAction
// ---------------------------------------------------------------------------

describe("grantModelAccessAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockGrantAccess).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    // The userClient transport throws the denial from inside the RPC call
    // (dashboard#848 / #902); model it on the client method mock.
    mockGrantAccess.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/GrantAccess",
        "relation-not-met",
      ),
    );
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });

  it("keeps the daemon error message for non-authz failures", async () => {
    mockGrantAccess.mockRejectedValueOnce(new Error("daemon exploded"));
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).not.toBe("permission_denied");
    expect(result.error).toBe("daemon exploded");
  });
});

// ---------------------------------------------------------------------------
// revokeModelAccessAction
// ---------------------------------------------------------------------------

describe("revokeModelAccessAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockRevokeAccess).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    mockRevokeAccess.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/RevokeAccess",
        "relation-not-met",
      ),
    );
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});
