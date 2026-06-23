/**
 * Unit tests for app/actions/crud/budgets.ts
 *
 * Focus: defense-in-depth authz gating (dashboard#864). Each mutating action
 * must call assertAuthorized against its own registered RPC BEFORE dialing the
 * daemon, and short-circuit an AuthzDeniedError with a "Permission denied"
 * result without ever touching the budget client.
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
  mockSetBudget,
  mockSetTenantBudgetDefaults,
  mockGetBudgetClient,
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
    mockAssertAuthorized: vi.fn(async () => undefined),
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
  assertAuthorized: mockAssertAuthorized,
  AuthzDeniedError: MockAuthzDeniedError,
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

describe("setBudgetAction, authz gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asserts authorization against the SetBudget RPC before dialing", async () => {
    const result = await setBudgetAction(validBudgetInput);
    expect(result.ok).toBe(true);
    expect(mockAssertAuthorized).toHaveBeenCalledWith(
      "/gibson.tenant.v1.BudgetService/SetBudget",
    );
    expect(mockSetBudget).toHaveBeenCalledOnce();
  });

  it("returns permission_denied and never dials the daemon when denied", async () => {
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.BudgetService/SetBudget",
        "relation-not-met",
      ),
    );
    const result = await setBudgetAction(validBudgetInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockGetBudgetClient).not.toHaveBeenCalled();
    expect(mockSetBudget).not.toHaveBeenCalled();
  });

  it("calls assertAuthorized before the daemon client is constructed", async () => {
    const order: string[] = [];
    mockAssertAuthorized.mockImplementationOnce(async () => {
      order.push("assert");
    });
    mockGetBudgetClient.mockImplementationOnce(async () => {
      order.push("client");
      return { setBudget: mockSetBudget, setTenantBudgetDefaults: mockSetTenantBudgetDefaults };
    });
    await setBudgetAction(validBudgetInput);
    expect(order).toEqual(["assert", "client"]);
  });
});

// ---------------------------------------------------------------------------
// setTenantBudgetDefaultsAction
// ---------------------------------------------------------------------------

describe("setTenantBudgetDefaultsAction, authz gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asserts authorization against the SetTenantBudgetDefaults RPC", async () => {
    const result = await setTenantBudgetDefaultsAction(validDefaults);
    expect(result.ok).toBe(true);
    expect(mockAssertAuthorized).toHaveBeenCalledWith(
      "/gibson.tenant.v1.BudgetService/SetTenantBudgetDefaults",
    );
    expect(mockSetTenantBudgetDefaults).toHaveBeenCalledOnce();
  });

  it("returns permission_denied and never dials the daemon when denied", async () => {
    mockAssertAuthorized.mockRejectedValueOnce(
      new MockAuthzDeniedError(
        "/gibson.tenant.v1.BudgetService/SetTenantBudgetDefaults",
        "relation-not-met",
      ),
    );
    const result = await setTenantBudgetDefaultsAction(validDefaults);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-ok");
    expect(result.code).toBe("permission_denied");
    expect(mockGetBudgetClient).not.toHaveBeenCalled();
    expect(mockSetTenantBudgetDefaults).not.toHaveBeenCalled();
  });
});
