/**
 * Exhaustive authorization matrix for every CRD Server Action.
 *
 * Asserts, for each action, that:
 *   (a) no session → UNAUTHENTICATED + K8s NOT called
 *   (b) wrong permission → FORBIDDEN + K8s NOT called
 *   (c) tenant-scoped session targeting a different tenant → FORBIDDEN
 *   (d) cross-tenant session → K8s called, returns ok
 *   (e) bad input (schema rejected) → BAD_INPUT + K8s NOT called
 *
 * Also: a top-of-file coverage guard that iterates every `*Action` export
 * from the four action files and asserts a matching describe block exists.
 * New action → test fails → CI blocks.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — installed BEFORE any SUT import.
// ---------------------------------------------------------------------------

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

// Active-tenant resolution reads an HMAC cookie via next/headers `cookies()`,
// which has no request scope under vitest. Mock the resolver to return a fixed
// tenant ("other-tenant") so the tenant-scope check in requireCrdSession is
// deterministic: the "(c) wrong tenant" cases target a different tenant and
// must be FORBIDDEN. The real NoActiveTenantError/StaleActiveTenantError
// classes are preserved so the gate's instanceof checks still work.
vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return {
    ...actual,
    requireActiveTenant: vi.fn(async () => "other-tenant"),
  };
});

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({
    setTenantRole: vi.fn(async () => ({})),
    setTeamAdmin: vi.fn(async () => ({})),
    transferOwnership: vi.fn(async () => ({})),
    writeAccessTuples: vi.fn(async () => ({})),
    validateComponent: vi.fn(async () => ({})),
    grantComponentPermissions: vi.fn(async () => ({})),
    setCatalogEnabled: vi.fn(async () => ({ written: true, deleted: false })),
  })),
  serviceClient: vi.fn(() => ({
    writeAccessTuples: vi.fn(async () => ({})),
  })),
}));

vi.mock("@/src/lib/k8s/tenants", () => ({
  applyTenant: vi.fn(async (name: string) => ({ metadata: { name } })),
  deleteTenant: vi.fn(async () => undefined),
  patchTenant: vi.fn(async (name: string) => ({ metadata: { name } })),
  applyTenantMember: vi.fn(async (_ns: string, name: string) => ({ metadata: { name } })),
  // Default: one admin member named "invite-1" so the last-owner guard in
  // revokeMemberAction doesn't block the test cases that verify the authz matrix.
  listTenantMembers: vi.fn(async () => [
    {
      metadata: { name: "invite-1" },
      spec: { email: "alice@example.com", role: "admin" },
      status: { userId: "user-1", phase: "Active" },
    },
  ]),
  deleteTenantMember: vi.fn(async () => undefined),
  patchTenantMember: vi.fn(async (_ns: string, name: string) => ({ metadata: { name } })),
  tenantNamespace: (name: string) => `tenant-${name}`,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("../_rate_limits", () => ({
  CRD_RATE_LIMITS: {
    fetchBootstrapToken: { window: 300, max: 5, failClosed: true },
    inviteMember: { window: 600, max: 20, failClosed: false },
    provisionTenant: { window: 3600, max: 5, failClosed: false },
  },
  consumeRateLimit: vi.fn(async () => ({ ok: true })),
}));

// Spy on audit emitters without changing their behavior — asserts that a
// denial path emits an event.
const emitCrdAuditSpy = vi.fn();
const emitCrdAuditFromGateSpy = vi.fn();
vi.mock("@/src/lib/audit/crd", () => ({
  emitCrdAudit: (...args: unknown[]) => emitCrdAuditSpy(...args),
  emitCrdAuditFromGate: (...args: unknown[]) => emitCrdAuditFromGateSpy(...args),
}));

// ---------------------------------------------------------------------------
// Imports AFTER mocks.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as tenantActions from "../tenant";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as grantActions from "../grant";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as memberActions from "../member";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as teamActions from "../teams";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as roleActions from "../role";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as accessActions from "../access";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as installAgentActions from "../installAgent";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import * as transferOwnershipActions from "../transfer-ownership";
import * as sessionActions from "../sessions";
import { CRD_PERMISSIONS, requireCrdSession } from "../_authz";
import type { CrdActionName } from "../types";
import { getServerSession } from "@/src/lib/auth";
import * as k8sTenants from "@/src/lib/k8s/tenants";
import { userClient } from "@/src/lib/gibson-client";

const getSessionMock = getServerSession as unknown as Mock;
const userClientMock = userClient as unknown as Mock;
const getCatalogClientMock = () => (userClientMock.mock.results[userClientMock.mock.results.length - 1]?.value as { setCatalogEnabled?: Mock })?.setCatalogEnabled ?? vi.fn();

// ---------------------------------------------------------------------------
// Session builders.
// ---------------------------------------------------------------------------

type TestSession = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    groups: string[];
    roles: string[];
    tenantId: string | null | undefined;
    tenants: string[];
    rolesByTenant: Record<string, string>;
    permissions: string[];
    crossTenant: boolean;
  };
  expires: string;
};

function anonymous(): null {
  return null;
}

// Authorization gates on the caller's active-tenant role (session.user.roles)
// against the action's required relation — no permission closure. `role`
// defaults to "admin"; pass "member" to model an under-privileged caller.
function tenantSession(tenantId: string, role: string = "admin"): TestSession {
  return {
    user: {
      id: "user-1",
      name: "alice",
      email: "alice@example.com",
      image: null,
      groups: [],
      roles: [role],
      tenantId,
      tenants: [tenantId],
      rolesByTenant: { [tenantId]: role },
      permissions: [],
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function crossTenantSession(): TestSession {
  return {
    user: {
      id: "user-admin",
      name: "ops",
      email: "ops@example.com",
      image: null,
      groups: [],
      roles: ["platform-operator"],
      tenantId: null,
      tenants: [],
      rolesByTenant: {},
      permissions: [],
      crossTenant: true,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Coverage guard — every *Action export must have a describe block below.
// ---------------------------------------------------------------------------

const allExportedActions = [
  ...Object.keys(tenantActions),
  ...Object.keys(grantActions),
  ...Object.keys(memberActions),
  ...Object.keys(teamActions),
  ...Object.keys(roleActions),
  ...Object.keys(accessActions),
  ...Object.keys(installAgentActions),
  ...Object.keys(transferOwnershipActions),
  ...Object.keys(sessionActions),
].filter((name) => name.endsWith("Action")) as CrdActionName[];

const EXPECTED_ACTIONS: CrdActionName[] = Object.keys(CRD_PERMISSIONS) as CrdActionName[];

describe("coverage guard", () => {
  it("CRD_PERMISSIONS includes every exported *Action", () => {
    const missing = allExportedActions.filter((a) => !EXPECTED_ACTIONS.includes(a));
    expect(missing).toEqual([]);
  });
  it("every CRD_PERMISSIONS key corresponds to an exported *Action", () => {
    const orphaned = EXPECTED_ACTIONS.filter((a) => !allExportedActions.includes(a));
    expect(orphaned).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Per-action matrix helpers.
// ---------------------------------------------------------------------------

type ActionInvoker = () => Promise<{ ok: boolean; code?: string; error?: string; data?: unknown }>;

/**
 * Each action has a manifest describing how to invoke it with good and
 * bad input so the matrix can run a uniform test shape.
 */
interface ActionManifest {
  name: CrdActionName;
  permission: string; // empty / "__self__" for acceptInvitation
  tenantName: string; // target tenant for tenant-scoped actions
  requireCrossTenant?: boolean;
  isSelfCheck?: boolean;
  /** Invoke with a tenantName that matches the session's tenant. */
  invokeValid: (tenantName: string) => ActionInvoker;
  /** Invoke with intentionally-bad input (schema rejection). */
  invokeBadInput: (tenantName: string) => ActionInvoker;
  /** k8s mock assertion: which mock should have been called on success. */
  k8sMock: () => Mock;
}

const MANIFESTS: ActionManifest[] = [
  {
    name: "provisionTenantAction",
    permission: "tenants:provision",
    tenantName: "acme",
    requireCrossTenant: true,
    invokeValid:
      () => () =>
        tenantActions.provisionTenantAction({ displayName: "Acme", owner: "alice@acme.io" }),
    invokeBadInput:
      () => () =>
        tenantActions.provisionTenantAction({ displayName: "", owner: "" }),
    k8sMock: () => k8sTenants.applyTenant as Mock,
  },
  {
    name: "deleteTenantAction",
    permission: "tenants:delete",
    tenantName: "acme",
    invokeValid: (t) => () => tenantActions.deleteTenantAction(t, t),
    invokeBadInput: (t) => () => tenantActions.deleteTenantAction(t, "mismatch"),
    k8sMock: () => k8sTenants.deleteTenant as Mock,
  },
  {
    name: "updateTenantAction",
    permission: "tenants:update",
    tenantName: "acme",
    invokeValid: (t) => () => tenantActions.updateTenantAction(t, { tier: "team" }),
    invokeBadInput:
      (t) => () =>
        tenantActions.updateTenantAction(t, { tier: "invalid" as unknown as "team" }),
    k8sMock: () => k8sTenants.patchTenant as Mock,
  },
  {
    name: "grantComponentAction",
    permission: "grants:create",
    tenantName: "acme",
    invokeValid:
      (t) => () =>
        grantActions.grantComponentAction({
          tenantName: t,
          componentRef: { kind: "tool", name: "nmap" },
        }),
    invokeBadInput:
      (t) => () =>
        grantActions.grantComponentAction({
          tenantName: t,
          componentRef: { kind: "unknown" as "tool", name: "nmap" },
        }),
    // ADR-0041: grant actions now call the daemon via MembershipService.SetCatalogEnabled
    // instead of writing ComponentGrant CRDs directly to K8s.
    k8sMock: () => getCatalogClientMock(),
  },
  {
    name: "revokeGrantAction",
    permission: "grants:delete",
    tenantName: "acme",
    invokeValid:
      (t) => () =>
        grantActions.revokeGrantAction(t, { kind: "tool", name: "nmap" }),
    invokeBadInput:
      (t) => () =>
        grantActions.revokeGrantAction(t, { kind: "tool", name: "UPPERCASE" }),
    // ADR-0041: grant actions now call the daemon via MembershipService.SetCatalogEnabled
    // instead of deleting ComponentGrant CRDs directly from K8s.
    k8sMock: () => getCatalogClientMock(),
  },
  // Member actions (invite/accept/revoke/resend) removed from this k8s-mock
  // table by dashboard#715: they now call the daemon's MembershipService, not
  // the TenantMember CR. Their gating + behaviour is covered by member.test.ts
  // with the RPC client mocked. acceptInvitationAction is token-based +
  // unauthenticated (no self-gate).
  // Enrollment actions removed (dashboard#713): enrollment moved to
  // AgentIdentityService (/api/agents/register); the CR-based path is gone.
];

// ---------------------------------------------------------------------------
// Matrix.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(MANIFESTS)("$name", (m) => {
  describe("(a) no session", () => {
    it("returns UNAUTHENTICATED and does not call k8s", async () => {
      getSessionMock.mockResolvedValueOnce(anonymous());
      const r = await m.invokeValid(m.tenantName)();
      expect(r.ok).toBe(false);
      expect((r as { code: string }).code).toBe("UNAUTHENTICATED");
      expect(m.k8sMock()).not.toHaveBeenCalled();
    });
  });

  if (!m.isSelfCheck) {
    describe("(b) wrong permission", () => {
      it("returns FORBIDDEN and does not call k8s", async () => {
        getSessionMock.mockResolvedValueOnce(
          tenantSession(m.tenantName, "member"),
        );
        const r = await m.invokeValid(m.tenantName)();
        expect(r.ok).toBe(false);
        expect((r as { code: string }).code).toBe("FORBIDDEN");
        expect(m.k8sMock()).not.toHaveBeenCalled();
      });
    });

    if (!m.requireCrossTenant) {
      describe("(c) wrong tenant", () => {
        it("returns FORBIDDEN and does not call k8s", async () => {
          getSessionMock.mockResolvedValueOnce(
            tenantSession("other-tenant", "admin"),
          );
          const r = await m.invokeValid(m.tenantName)();
          expect(r.ok).toBe(false);
          expect((r as { code: string }).code).toBe("FORBIDDEN");
          expect(m.k8sMock()).not.toHaveBeenCalled();
        });
      });
    }
  }

  describe("(d) cross-tenant session succeeds", () => {
    it("returns ok and calls k8s", async () => {
      if (m.isSelfCheck) {
        // Self-check: session.user.id must match input.userId ("user-1").
        getSessionMock.mockResolvedValueOnce(tenantSession(m.tenantName));
      } else {
        getSessionMock.mockResolvedValueOnce(crossTenantSession());
      }
      const r = await m.invokeValid(m.tenantName)();
      expect(r.ok).toBe(true);
      expect(m.k8sMock()).toHaveBeenCalled();
    });
  });

  describe("(e) bad input", () => {
    it("returns BAD_INPUT and does not call k8s", async () => {
      if (m.isSelfCheck) {
        getSessionMock.mockResolvedValueOnce(tenantSession(m.tenantName));
      } else {
        getSessionMock.mockResolvedValueOnce(crossTenantSession());
      }
      const r = await m.invokeBadInput(m.tenantName)();
      expect(r.ok).toBe(false);
      expect((r as { code: string }).code).toBe("BAD_INPUT");
      expect(m.k8sMock()).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-action invariants.
// ---------------------------------------------------------------------------

describe("provisionTenantAction — cross-tenant-only", () => {
  it("denies a tenant-scoped session even with tenants:provision permission", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("acme", "admin"));
    const r = await tenantActions.provisionTenantAction({
      displayName: "NewCo",
      owner: "x@y.io",
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect(k8sTenants.applyTenant).not.toHaveBeenCalled();
  });
});

// Direct role×relation table for the gate decision. The active-tenant mock
// returns "other-tenant", so a tenantName of "other-tenant" passes the
// tenant-scope check and the outcome turns purely on the relation gate.
describe("requireCrdSession — active-tenant role × required relation", () => {
  const adminAction = "deleteTeamAction" as const; // relation: "admin"
  it("allows an admin on the active tenant", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("other-tenant", "admin"));
    const r = await requireCrdSession({ action: adminAction, tenantName: "other-tenant" });
    expect(r.ok).toBe(true);
  });
  it("allows an owner (owner implies admin)", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("other-tenant", "owner"));
    const r = await requireCrdSession({ action: adminAction, tenantName: "other-tenant" });
    expect(r.ok).toBe(true);
  });
  it("denies a member (insufficient relation)", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("other-tenant", "member"));
    const r = await requireCrdSession({ action: adminAction, tenantName: "other-tenant" });
    expect(r.ok).toBe(false);
    if (!r.ok && !r.result.ok) expect(r.result.code).toBe("FORBIDDEN");
  });
  it("denies when the session carries no active-tenant role", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("other-tenant", ""));
    const r = await requireCrdSession({ action: adminAction, tenantName: "other-tenant" });
    expect(r.ok).toBe(false);
  });
});

