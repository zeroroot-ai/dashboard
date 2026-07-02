/**
 * Unit tests for app/actions/crud/modelAccess.ts
 *
 * Focus: defense-in-depth authz gating (dashboard#864). The grant/revoke
 * mutating actions must call assertAuthorized against their own registered RPC
 * BEFORE dialing the daemon, and short-circuit an AuthzDeniedError with a
 * "Permission denied" result without ever touching the model-access client.
 *
 * Mocks the gibson-client factory and the assert-authorized helper so the
 * tests run without a live gRPC connection. Mirrors app/actions/__tests__/
 * secrets.test.ts.
 *
 * Refs #864 / #818.
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
  mockAssertAuthorized,
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
    mockAssertAuthorized: vi.fn(async () => undefined),
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
  assertAuthorized: mockAssertAuthorized,
  AuthzDeniedError: MockAuthzDeniedError,
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

describe("grantModelAccessAction, authz gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asserts authorization against the GrantAccess RPC before dialing", async () => {
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockAssertAuthorized).toHaveBeenCalledWith(
      "/gibson.tenant.v1.ModelAccessService/GrantAccess",
    );
    expect(mockGrantAccess).toHaveBeenCalledOnce();
  });

  it("returns permission_denied and never dials the daemon when denied", async () => {
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/GrantAccess",
        "relation-not-met",
      ),
    );
    const result = await grantModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockGetModelAccessClient).not.toHaveBeenCalled();
    expect(mockGrantAccess).not.toHaveBeenCalled();
  });

  it("calls assertAuthorized before the daemon client is constructed", async () => {
    const order: string[] = [];
    mockAssertAuthorized.mockImplementationOnce(async () => {
      order.push("assert");
    });
    mockGetModelAccessClient.mockImplementationOnce(async () => {
      order.push("client");
      return { grantAccess: mockGrantAccess, revokeAccess: mockRevokeAccess };
    });
    await grantModelAccessAction(validInput);
    expect(order).toEqual(["assert", "client"]);
  });
});

// ---------------------------------------------------------------------------
// revokeModelAccessAction
// ---------------------------------------------------------------------------

describe("revokeModelAccessAction, authz gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asserts authorization against the RevokeAccess RPC before dialing", async () => {
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(true);
    expect(mockAssertAuthorized).toHaveBeenCalledWith(
      "/gibson.tenant.v1.ModelAccessService/RevokeAccess",
    );
    expect(mockRevokeAccess).toHaveBeenCalledOnce();
  });

  it("returns permission_denied and never dials the daemon when denied", async () => {
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.ModelAccessService/RevokeAccess",
        "relation-not-met",
      ),
    );
    const result = await revokeModelAccessAction(validInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockGetModelAccessClient).not.toHaveBeenCalled();
    expect(mockRevokeAccess).not.toHaveBeenCalled();
  });
});
