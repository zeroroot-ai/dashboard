/**
 * Integration tests for signUpAction — Tasks 21 & 22 (auth-flow-hardening).
 *
 * Scenarios:
 *   (a) Happy path: fresh slug, new email → ok=true, user+org+membership
 *       created, tenant applied, audit events in order.
 *   (b) Slug collision: pre-flight detects collision, returns
 *       COMPANY_NAME_TAKEN, NO user row created.
 *   (c) Duplicate email: returns EMAIL_ALREADY_REGISTERED; wall-clock time
 *       padded by scrypt; no new user row.
 *   (d) Org create transient fail → retry → success: 2 failures then
 *       success; user kept, org created on 3rd attempt.
 *   (e) Org create permanent fail: 3 failures, user rolled back via
 *       deleteUser, SERVICE_UNAVAILABLE returned.
 *   (f) Tenant CR apply fails: user + org kept, provisioningPending=true
 *       returned, signup_failed audit with reason=tenant_apply_failed.
 *   (g) CAPTCHA failure: returns CAPTCHA_FAILED without touching user/org.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mock declarations — vi.mock is hoisted before any import; factories must
// NOT reference module-scope variables (TDZ). Use vi.fn() inline only.
// ---------------------------------------------------------------------------

// next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Map()),
}));

// Rate limiter — always allow.
vi.mock("@/src/lib/rate-limiter", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

// CAPTCHA verifier — default to ok:true; overridden per test.
vi.mock("@/src/lib/auth/captcha", () => ({
  verifyCaptcha: vi.fn().mockResolvedValue({ ok: true }),
}));

// Correlation — stable ID.
vi.mock("@/src/lib/correlation", () => ({
  getCorrelationId: vi.fn().mockReturnValue("test-correlation-id"),
}));

// Audit emitter — spy.
vi.mock("@/src/lib/audit/auth", () => ({
  emitAuthAudit: vi.fn(),
}));

// Metrics — spy.
vi.mock("@/src/lib/metrics/auth", () => ({
  signupAttempts: { inc: vi.fn() },
  captchaFailures: { inc: vi.fn() },
}));

// K8s tenant apply — default success.
vi.mock("@/src/lib/k8s/tenants", () => ({
  applyTenant: vi.fn().mockResolvedValue({ metadata: { name: "acme-security" } }),
  tenantNamespace: vi.fn().mockReturnValue("tenant-acme-security"),
}));

// Better Auth org adapter for slug pre-flight.
// The inner vi.fn()s are defined inside the factory (no outer reference).
vi.mock("better-auth/plugins/organization", () => ({
  getOrgAdapter: vi.fn(() => ({
    findOrganizationBySlug: vi.fn().mockResolvedValue(null),
  })),
}));

// Better Auth server — all api methods as vi.fn()s inside the factory.
vi.mock("@/src/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({}),
    api: {
      signUpEmail: vi.fn().mockResolvedValue({ user: { id: "user-abc" } }),
      createOrganization: vi.fn().mockResolvedValue({ id: "org-xyz" }),
      // The admin plugin exposes removeUser; signup.ts casts to any to call it.
      removeUser: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports AFTER mock declarations.
// ---------------------------------------------------------------------------

import { signUpAction } from "../signup";
import { verifyCaptcha } from "@/src/lib/auth/captcha";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { applyTenant } from "@/src/lib/k8s/tenants";
import { signupAttempts } from "@/src/lib/metrics/auth";
import { auth } from "@/src/lib/auth-server";
import { getOrgAdapter } from "better-auth/plugins/organization";

// Typed references to mock functions. auth.api is cast through unknown because
// the Better Auth types are strict endpoints, not vi.fn() shapes — the mocks
// installed by vi.mock() replace them at runtime but TS still sees the originals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authApiAny = (auth as any).api;

const mockVerifyCaptcha = verifyCaptcha as Mock;
const mockEmitAuthAudit = emitAuthAudit as Mock;
const mockApplyTenant = applyTenant as Mock;
const mockSignupAttemptsInc = (signupAttempts as unknown as { inc: Mock }).inc;
const mockSignUpEmail = authApiAny.signUpEmail as Mock;
const mockCreateOrganization = authApiAny.createOrganization as Mock;
const mockRemoveUser = authApiAny.removeUser as Mock;
const mockGetOrgAdapter = getOrgAdapter as Mock;

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  companyName: "Acme Security",
  email: "alice@example.com",
  password: "Correct-Horse-Battery-Staple1!",
  confirmPassword: "Correct-Horse-Battery-Staple1!",
  tosAccepted: true as const,
  plan: "free",
};

beforeEach(() => {
  vi.clearAllMocks();

  // Restore safe defaults that individual tests may override.
  mockGetOrgAdapter.mockReturnValue({
    findOrganizationBySlug: vi.fn().mockResolvedValue(null),
  });
  mockSignUpEmail.mockResolvedValue({ user: { id: "user-abc" } });
  mockCreateOrganization.mockResolvedValue({ id: "org-xyz" });
  mockRemoveUser.mockResolvedValue(undefined);
  mockApplyTenant.mockResolvedValue({ metadata: { name: "acme-security" } });
  mockVerifyCaptcha.mockResolvedValue({ ok: true });
});

// ---------------------------------------------------------------------------
// (a) Happy path
// ---------------------------------------------------------------------------
describe("(a) happy path — fresh slug, new email", () => {
  it("returns ok:true with tenantId + userId; org and tenant created; audit fired", async () => {
    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");
    expect(result.tenantId).toBe("acme-security");
    expect(result.userId).toBe("user-abc");
    expect(result.provisioningPending).toBeFalsy();

    // signup_started → signup_completed in order.
    expect(mockEmitAuthAudit).toHaveBeenCalledTimes(2);
    const auditActions = mockEmitAuthAudit.mock.calls.map((c: unknown[]) => (c[0] as { action: string }).action);
    expect(auditActions[0]).toBe("signup_started");
    expect(auditActions[1]).toBe("signup_completed");

    // Org and tenant were created exactly once.
    expect(mockCreateOrganization).toHaveBeenCalledTimes(1);
    expect(mockApplyTenant).toHaveBeenCalledTimes(1);
    expect(mockApplyTenant).toHaveBeenCalledWith(
      "acme-security",
      expect.objectContaining({
        displayName: "Acme Security",
        owner: "alice@example.com",
        tier: "free",
      }),
    );

    // User NOT rolled back.
    expect(mockRemoveUser).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (b) Slug collision
// ---------------------------------------------------------------------------
describe("(b) slug collision — pre-flight detects taken slug", () => {
  it("returns COMPANY_NAME_TAKEN; user table never touched", async () => {
    mockGetOrgAdapter.mockReturnValue({
      findOrganizationBySlug: vi.fn().mockResolvedValue({ id: "existing-org" }),
    });

    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("COMPANY_NAME_TAKEN");
    expect(result.field).toBe("companyName");

    // signUpEmail must NOT have been called.
    expect(mockSignUpEmail).not.toHaveBeenCalled();
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockApplyTenant).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (c) Duplicate email — constant-time padding
// ---------------------------------------------------------------------------
describe("(c) duplicate email — constant-time scrypt padding", () => {
  it("returns EMAIL_ALREADY_REGISTERED; scrypt burn pads timing; no org/tenant created", async () => {
    mockSignUpEmail.mockRejectedValue(
      new Error("User already exists: user_already_exists"),
    );

    const start = performance.now();
    const result = await signUpAction(VALID_INPUT);
    const duration = performance.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("EMAIL_ALREADY_REGISTERED");
    expect(result.field).toBe("email");

    // No org or tenant created.
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockApplyTenant).not.toHaveBeenCalled();
    expect(mockRemoveUser).not.toHaveBeenCalled();

    // The scrypt burn should add measurable CPU time (scrypt N=16384 typically
    // costs 50–150ms; we use 30ms as the lower bound to account for JIT warm-up
    // and fast CI hardware variance, while still proving the pad ran).
    expect(duration).toBeGreaterThan(30);
    console.info(`[timing] duplicate-email duration=${duration.toFixed(0)}ms`);
  });
});

// ---------------------------------------------------------------------------
// (d) Org create transient fail → retry → success
// ---------------------------------------------------------------------------
describe("(d) org create transient failure then success on 3rd attempt", () => {
  it("retries twice then succeeds; user kept; org created on attempt 3", async () => {
    let attempts = 0;
    mockCreateOrganization.mockImplementation(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("transient: connection refused");
      return { id: "org-xyz" };
    });

    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");
    expect(result.tenantId).toBe("acme-security");
    expect(result.userId).toBe("user-abc");

    // createOrganization was called 3 times (2 failures + 1 success).
    expect(mockCreateOrganization).toHaveBeenCalledTimes(3);

    // User NOT rolled back.
    expect(mockRemoveUser).not.toHaveBeenCalled();

    // Tenant still applied.
    expect(mockApplyTenant).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// (e) Org create permanent fail — user rolled back
// ---------------------------------------------------------------------------
describe("(e) org create permanent failure — user rollback + SERVICE_UNAVAILABLE", () => {
  it("returns SERVICE_UNAVAILABLE; deleteUser called; tenant NOT applied", async () => {
    mockCreateOrganization.mockRejectedValue(new Error("org creation failed permanently"));

    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("SERVICE_UNAVAILABLE");

    // All 3 retry attempts fired.
    expect(mockCreateOrganization).toHaveBeenCalledTimes(3);

    // User was rolled back.
    expect(mockRemoveUser).toHaveBeenCalledTimes(1);
    expect(mockRemoveUser).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { userId: "user-abc" },
      }),
    );

    // Tenant CR was NOT applied.
    expect(mockApplyTenant).not.toHaveBeenCalled();

    // signup_failed audit with reason=org_create_failed.
    const auditCalls = mockEmitAuthAudit.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
    const failAudit = auditCalls.find(
      (e) => e.action === "signup_failed" && e.reason === "org_create_failed",
    );
    expect(failAudit).toBeDefined();

    // Metrics: failed outcome with org_create_failed reason.
    expect(mockSignupAttemptsInc).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", reason: "org_create_failed" }),
    );
  });
});

// ---------------------------------------------------------------------------
// (f) Tenant CR apply fails — provisioningPending
// ---------------------------------------------------------------------------
describe("(f) tenant CR apply fails — provisioningPending returned", () => {
  it("returns ok:true with provisioningPending; user and org kept; audit emitted", async () => {
    mockApplyTenant.mockRejectedValue(
      Object.assign(new Error("K8s API unreachable"), { name: "K8sError" }),
    );

    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok:true");
    expect(result.provisioningPending).toBe(true);
    expect(result.userId).toBe("user-abc");
    expect(result.tenantId).toBe("acme-security");

    // User and org must be intact — NO rollback.
    expect(mockRemoveUser).not.toHaveBeenCalled();
    expect(mockCreateOrganization).toHaveBeenCalledTimes(1);

    // signup_failed audit with reason=tenant_apply_failed.
    const auditCalls = mockEmitAuthAudit.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>);
    const failAudit = auditCalls.find(
      (e) =>
        e.action === "signup_failed" && e.reason === "tenant_apply_failed",
    );
    expect(failAudit).toBeDefined();
    expect(String(failAudit!.errorMessage)).toContain("K8s API unreachable");
  });
});

// ---------------------------------------------------------------------------
// (g) CAPTCHA failure — no side-effects
// ---------------------------------------------------------------------------
describe("(g) CAPTCHA failure — no side-effects on user/org/tenant", () => {
  it("returns CAPTCHA_FAILED; no user, org, or tenant created", async () => {
    mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "timeout" });

    const result = await signUpAction({
      ...VALID_INPUT,
      captchaToken: "invalid-token",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("CAPTCHA_FAILED");

    // Nothing downstream touched.
    expect(mockSignUpEmail).not.toHaveBeenCalled();
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockApplyTenant).not.toHaveBeenCalled();
    expect(mockRemoveUser).not.toHaveBeenCalled();
  });

  it("missing captcha token under an enabled provider → CAPTCHA_FAILED", async () => {
    // Enabled-provider behaviour: verifyCaptcha rejects an empty token.
    mockVerifyCaptcha.mockImplementation(async (token: string) => {
      if (typeof token !== "string" || token.length === 0) {
        return { ok: false, reason: "missing_token" };
      }
      return { ok: true };
    });

    const result = await signUpAction(VALID_INPUT);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected ok:false");
    expect(result.code).toBe("CAPTCHA_FAILED");

    // No side-effects.
    expect(mockSignUpEmail).not.toHaveBeenCalled();
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockApplyTenant).not.toHaveBeenCalled();
  });
});
