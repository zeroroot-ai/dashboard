/**
 * Unit tests for app/actions/crud/budgets.ts
 *
 * Focus: defense-in-depth authz mapping (dashboard#864 / #904). The per-RPC
 * authz check is baked into the userClient transport (dashboard#848 / #902),
 * so a denial is thrown from INSIDE the daemon RPC call as AuthzDeniedError.
 * The mutating actions must map that denial to the canonical
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
  mockSetBudget,
  mockSetTenantBudgetDefaults,
  mockGetBudgetClient,
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
  const setBudget = vi.fn(async () => ({}));
  const setTenantBudgetDefaults = vi.fn(async () => ({}));
  return {
    mockSetBudget: setBudget,
    mockSetTenantBudgetDefaults: setTenantBudgetDefaults,
    mockGetBudgetClient: vi.fn(async () => ({
      setBudget,
      setTenantBudgetDefaults,
    })),
    mockGetServerSession: vi.fn(async () => ({
      user: { id: "user-1", tenantId: "tenant-abc" },
    })),
    MockAuthzDeniedError: _MockAuthzDeniedError,
  };
});

vi.mock("server-only", () => ({}));

vi.mock("@/src/lib/gibson-client", () => ({
  getBudgetClient: mockGetBudgetClient,
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

vi.mock("@/src/gen/gibson/budget_status/v1/budget_status_pb", () => ({
  BudgetScope: { UNSPECIFIED: 0, USER: 1, TEAM: 2, TENANT: 3 },
}));

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import {
  setBudgetAction,
  setTenantBudgetDefaultsAction,
  type SetBudgetInput,
  type TenantDefaultsRow,
} from "../budgets";

const validBudgetInput: SetBudgetInput = {
  scope: "user",
  subjectId: "user-2",
  monthlyTokens: 1000,
  monthlySpendUsdCents: 500,
};

const validDefaults: TenantDefaultsRow = {
  defaultUserMonthlyTokens: 1000,
  defaultUserMonthlySpendUsdCents: 500,
  defaultTeamMonthlyTokens: 2000,
  defaultTeamMonthlySpendUsdCents: 1000,
  defaultWarningThreshold: 0.8,
};

// ---------------------------------------------------------------------------
// setBudgetAction
// ---------------------------------------------------------------------------

describe("setBudgetAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await setBudgetAction(validBudgetInput);
    expect(result.ok).toBe(true);
    expect(mockSetBudget).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    // The userClient transport throws the denial from inside the RPC call
    // (dashboard#848 / #902); model it on the client method mock.
    mockSetBudget.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.BudgetService/SetBudget",
        "relation-not-met",
      ),
    );
    const result = await setBudgetAction(validBudgetInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });

  it("keeps the daemon error message for non-authz failures", async () => {
    mockSetBudget.mockRejectedValueOnce(new Error("daemon exploded"));
    const result = await setBudgetAction(validBudgetInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).not.toBe("permission_denied");
    expect(result.error).toBe("daemon exploded");
  });
});

// ---------------------------------------------------------------------------
// setTenantBudgetDefaultsAction
// ---------------------------------------------------------------------------

describe("setTenantBudgetDefaultsAction, authz mapping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds and dials the daemon for an authorized caller", async () => {
    const result = await setTenantBudgetDefaultsAction(validDefaults);
    expect(result.ok).toBe(true);
    expect(mockSetTenantBudgetDefaults).toHaveBeenCalledOnce();
  });

  it("maps a wrapper-thrown AuthzDeniedError to permission_denied", async () => {
    mockSetTenantBudgetDefaults.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.BudgetService/SetTenantBudgetDefaults",
        "relation-not-met",
      ),
    );
    const result = await setTenantBudgetDefaultsAction(validDefaults);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(result.error).toBe("Permission denied");
  });
});
