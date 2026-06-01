/**
 * installAgentAction unit tests — covers the happy path and the adversarial
 * manifest case (caller lacks access).
 *
 * Spec: access-matrix-finish task 23, R5 AC 4/7 + NFR Reliability.
 * Migration: dashboard#359 — write path moved to userClient(TenantAdminService).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

// Tenant-scope resolution reads next/headers cookies(), which has no request
// scope under vitest. Pin the active tenant to "acme".
vi.mock("@/src/lib/auth/active-tenant", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/src/lib/auth/active-tenant")>();
  return {
    ...actual,
    requireActiveTenant: vi.fn(async () => "acme"),
    getActiveTenant: vi.fn(async () => "acme"),
  };
});

// installAgentAction now uses userClient(TenantAdminService) for the write
// path (grantComponentPermissions) and userClient(DiscoveryService) for
// validateComponent. The mock returns a stub keyed on the RPC it exposes.
const mockGrantComponentPermissions = vi.fn();
const mockValidateComponent = vi.fn();
vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({
    validateComponent: mockValidateComponent,
    grantComponentPermissions: mockGrantComponentPermissions,
  }),
}));
vi.mock("@/src/gen/gibson/daemon/discovery/v1/discovery_pb", () => ({
  DiscoveryService: { typeName: "discovery" },
}));
vi.mock("@/src/gen/gibson/tenant/v1/membership_pb", () => ({
  MembershipService: { typeName: "gibson.tenant.v1.MembershipService" },
}));

const mockList = vi.fn();
vi.mock("@/app/actions/read/listAccessibleComponents", () => ({
  listAccessibleComponentsAction: (...args: unknown[]) => mockList(...args),
}));

// node:crypto is real — randomUUID works under vitest/jsdom-node.

import { installAgentAction } from "../installAgent";
import { getServerSession } from "@/src/lib/auth";

function withSession(tenantId = "acme", role = "admin") {
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: {
      id: "user-1",
      tenantId,
      // requireCrdSession authorizes the active-tenant role against the
      // action's required relation (installAgentAction → admin).
      roles: [role],
      rolesByTenant: { [tenantId]: role },
      crossTenant: false,
    },
  });
}

describe("installAgentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateComponent.mockResolvedValue({
      ok: true,
      schemaErrors: [],
      accessErrors: [],
    });
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          kind: "plugin",
          name: "gitlab",
          rwx: { read: true, write: true, execute: true },
          denyingGates: [],
        },
      ],
    });
  });

  it("unauthenticated → error", async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await installAgentAction({
      agentSlug: "test-agent",
      componentYaml: "",
      permissionsYaml: "",
      approvals: [],
    });
    expect(r.ok).toBe(false);
  });

  it("happy path calls grantComponentPermissions with the approval list", async () => {
    withSession();
    mockGrantComponentPermissions.mockResolvedValue({
      agentInstallationId: "mocked",
    });

    const r = await installAgentAction({
      agentSlug: "test-agent",
      componentYaml: "",
      permissionsYaml: "",
      approvals: [
        { target: "component:plugin/gitlab", action: "execute", required: true },
      ],
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.agentInstallationId).toMatch(/-acme$/);
    }
    expect(mockGrantComponentPermissions).toHaveBeenCalledTimes(1);
    const call = mockGrantComponentPermissions.mock.calls[0][0];
    expect(call.agentInstallationId).toMatch(/-acme$/);
    expect(call.approvals).toHaveLength(1);
    expect(call.approvals[0].target).toBe("component:plugin/gitlab");
    expect(call.approvals[0].action).toBe("execute");
    expect(call.reason).toContain("test-agent");
  });

  it("adversarial manifest — caller lacks access → refused pre-write", async () => {
    withSession();
    mockList.mockResolvedValue({
      ok: true,
      data: [
        {
          kind: "plugin",
          name: "gitlab",
          rwx: { read: true, write: false, execute: false },
          denyingGates: [],
        },
      ],
    });

    const r = await installAgentAction({
      agentSlug: "test-agent",
      componentYaml: "",
      permissionsYaml: "",
      approvals: [
        { target: "component:plugin/gitlab", action: "execute", required: true },
      ],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("cannot grant what you lack");
      expect(r.error).toContain("component:plugin/gitlab:execute");
    }
    expect(mockGrantComponentPermissions).not.toHaveBeenCalled();
  });

  it("RPC failure → propagates error", async () => {
    withSession();
    mockGrantComponentPermissions.mockRejectedValueOnce(
      new Error("fga write failed"),
    );

    const r = await installAgentAction({
      agentSlug: "test-agent",
      componentYaml: "",
      permissionsYaml: "",
      approvals: [
        { target: "component:plugin/gitlab", action: "execute", required: true },
      ],
    });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("install failed");
      expect(r.error).toContain("fga write failed");
    }
    // Only one call — no compensating delete since server is atomic
    expect(mockGrantComponentPermissions).toHaveBeenCalledTimes(1);
  });

  it("empty approvals → no write, returns ok", async () => {
    withSession();
    const r = await installAgentAction({
      agentSlug: "test-agent",
      componentYaml: "",
      permissionsYaml: "",
      approvals: [],
    });
    expect(r.ok).toBe(true);
    expect(mockGrantComponentPermissions).not.toHaveBeenCalled();
  });
});
