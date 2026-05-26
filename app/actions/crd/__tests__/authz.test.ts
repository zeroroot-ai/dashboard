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

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: vi.fn(() => ({
    setTenantRole: vi.fn(async () => ({})),
    setTeamAdmin: vi.fn(async () => ({})),
    transferOwnership: vi.fn(async () => ({})),
    writeAccessTuples: vi.fn(async () => ({})),
    validateComponent: vi.fn(async () => ({})),
    grantComponentPermissions: vi.fn(async () => ({})),
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
  applyAgentEnrollment: vi.fn(async (_ns: string, name: string) => ({ metadata: { name } })),
  deleteAgentEnrollment: vi.fn(async () => undefined),
  getAgentEnrollment: vi.fn(async (_ns: string, name: string) => ({
    metadata: { name },
    status: { bootstrapSecretRef: "boot-secret" },
  })),
  getBootstrapToken: vi.fn(async () => ({ token: "TESTTOKEN", platformUrl: "https://test" })),
  applyComponentGrant: vi.fn(async (_ns: string, name: string) => ({ metadata: { name } })),
  deleteComponentGrant: vi.fn(async () => undefined),
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
import * as enrollmentActions from "../enrollment";
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
import { CRD_PERMISSIONS } from "../_authz";
import type { CrdActionName } from "../types";
import { getServerSession } from "@/src/lib/auth";
import * as k8sTenants from "@/src/lib/k8s/tenants";

const getSessionMock = getServerSession as unknown as Mock;

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

function tenantSession(tenantId: string, permissions: string[]): TestSession {
  return {
    user: {
      id: "user-1",
      name: "alice",
      email: "alice@example.com",
      image: null,
      groups: [],
      roles: ["admin"],
      tenantId,
      tenants: [tenantId],
      rolesByTenant: { [tenantId]: "admin" },
      permissions,
      crossTenant: false,
    },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function crossTenantSession(permissions: string[]): TestSession {
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
      permissions,
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
  ...Object.keys(enrollmentActions),
  ...Object.keys(teamActions),
  ...Object.keys(roleActions),
  ...Object.keys(accessActions),
  ...Object.keys(installAgentActions),
  ...Object.keys(transferOwnershipActions),
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
    k8sMock: () => k8sTenants.applyComponentGrant as Mock,
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
    k8sMock: () => k8sTenants.deleteComponentGrant as Mock,
  },
  {
    name: "inviteMemberAction",
    permission: "members:invite",
    tenantName: "acme",
    invokeValid:
      (t) => () =>
        memberActions.inviteMemberAction({
          tenantName: t,
          email: "b@example.com",
          role: "member",
        }),
    invokeBadInput:
      (t) => () =>
        memberActions.inviteMemberAction({
          tenantName: t,
          email: "not-an-email",
          role: "member",
        }),
    k8sMock: () => k8sTenants.applyTenantMember as Mock,
  },
  {
    name: "acceptInvitationAction",
    permission: "__self__",
    tenantName: "acme",
    isSelfCheck: true,
    invokeValid:
      (t) => () =>
        memberActions.acceptInvitationAction({
          tenantName: t,
          memberName: "invite-1",
          userId: "user-1", // matches tenantSession().user.id
        }),
    invokeBadInput:
      (t) => () =>
        memberActions.acceptInvitationAction({
          tenantName: t,
          memberName: "UPPERCASE",
          userId: "user-1",
        }),
    k8sMock: () => k8sTenants.patchTenantMember as Mock,
  },
  {
    name: "revokeMemberAction",
    permission: "members:revoke",
    tenantName: "acme",
    invokeValid: (t) => () => memberActions.revokeMemberAction(t, "invite-1"),
    invokeBadInput: (t) => () => memberActions.revokeMemberAction(t, "UPPERCASE"),
    k8sMock: () => k8sTenants.deleteTenantMember as Mock,
  },
  {
    name: "resendInvitationAction",
    permission: "members:invite",
    tenantName: "acme",
    invokeValid: (t) => () => memberActions.resendInvitationAction(t, "invite-1"),
    invokeBadInput: (t) => () => memberActions.resendInvitationAction(t, "UPPERCASE"),
    k8sMock: () => k8sTenants.patchTenantMember as Mock,
  },
  {
    name: "createEnrollmentAction",
    permission: "enrollments:create",
    tenantName: "acme",
    invokeValid:
      (t) => () =>
        enrollmentActions.createEnrollmentAction({
          tenantName: t,
          name: "agent-1",
          agentName: "breach-checker",
          mode: "autonomous",
        }),
    invokeBadInput:
      (t) => () =>
        enrollmentActions.createEnrollmentAction({
          tenantName: t,
          name: "UPPERCASE",
          agentName: "breach-checker",
          mode: "autonomous",
        }),
    k8sMock: () => k8sTenants.applyAgentEnrollment as Mock,
  },
  {
    name: "revokeEnrollmentAction",
    permission: "enrollments:delete",
    tenantName: "acme",
    invokeValid: (t) => () => enrollmentActions.revokeEnrollmentAction(t, "agent-1"),
    invokeBadInput:
      (t) => () => enrollmentActions.revokeEnrollmentAction(t, "UPPERCASE"),
    k8sMock: () => k8sTenants.deleteAgentEnrollment as Mock,
  },
  {
    name: "fetchBootstrapTokenAction",
    permission: "enrollments:read_bootstrap",
    tenantName: "acme",
    invokeValid:
      (t) => () => enrollmentActions.fetchBootstrapTokenAction(t, "agent-1"),
    invokeBadInput:
      (t) => () => enrollmentActions.fetchBootstrapTokenAction(t, "UPPERCASE"),
    k8sMock: () => k8sTenants.getAgentEnrollment as Mock,
  },
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
          tenantSession(m.tenantName, ["unrelated:permission"]),
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
            tenantSession("other-tenant", [m.permission]),
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
        getSessionMock.mockResolvedValueOnce(tenantSession(m.tenantName, []));
      } else {
        getSessionMock.mockResolvedValueOnce(crossTenantSession([m.permission]));
      }
      const r = await m.invokeValid(m.tenantName)();
      expect(r.ok).toBe(true);
      expect(m.k8sMock()).toHaveBeenCalled();
    });
  });

  describe("(e) bad input", () => {
    it("returns BAD_INPUT and does not call k8s", async () => {
      if (m.isSelfCheck) {
        getSessionMock.mockResolvedValueOnce(tenantSession(m.tenantName, []));
      } else {
        getSessionMock.mockResolvedValueOnce(crossTenantSession([m.permission]));
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
    getSessionMock.mockResolvedValueOnce(tenantSession("acme", ["tenants:provision"]));
    const r = await tenantActions.provisionTenantAction({
      displayName: "NewCo",
      owner: "x@y.io",
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect(k8sTenants.applyTenant).not.toHaveBeenCalled();
  });
});

describe("acceptInvitationAction — self-check", () => {
  it("rejects mismatched userId with FORBIDDEN", async () => {
    getSessionMock.mockResolvedValueOnce(tenantSession("acme", []));
    const r = await memberActions.acceptInvitationAction({
      tenantName: "acme",
      memberName: "invite-1",
      userId: "different-user",
    });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("FORBIDDEN");
    expect(k8sTenants.patchTenantMember).not.toHaveBeenCalled();
  });
});

describe("fetchBootstrapTokenAction — token scrubbed from audit", () => {
  it("audit event for a successful fetch does not contain the token value", async () => {
    getSessionMock.mockResolvedValueOnce(
      crossTenantSession(["enrollments:read_bootstrap"]),
    );
    const r = await enrollmentActions.fetchBootstrapTokenAction("acme", "agent-1");
    expect(r.ok).toBe(true);
    const audited = JSON.stringify(emitCrdAuditFromGateSpy.mock.calls);
    expect(audited).not.toContain("TESTTOKEN");
  });
});
