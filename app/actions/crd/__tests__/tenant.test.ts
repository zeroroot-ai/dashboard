/**
 * Unit tests for the admin tenant-lifecycle actions (dashboard#855 capstone).
 *
 * provisionTenantAction / updateTenantAction / deleteTenantAction now call the
 * daemon's gibson.tenant.v1.AdminTenantService (operator-pull, gibson#964)
 * through `userClient`, NOT a direct Kubernetes write. Each RPC RECORDS intent
 * and returns an op_id; the operator applies it to the Tenant CR
 * asynchronously. These tests assert the wire-shape contract: the right RPC is
 * called with the right request fields, the action returns success on enqueue
 * (carrying op_id where relevant), and update sends only the fields the patch
 * marks set (the *_set flags).
 *
 * Authz gating is exercised by the broader matrix in authz.test.ts; here the
 * gate is stubbed to allow so the focus stays on the RPC contract.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

const mocks = vi.hoisted(() => ({
  adminProvisionTenant: vi.fn(async (_req: Record<string, unknown>) => ({ opId: "op-123" })),
  adminUpdateTenant: vi.fn(async (_req: Record<string, unknown>) => ({ opId: "op-456" })),
  adminDeleteTenant: vi.fn(async (_req: Record<string, unknown>) => ({ opId: "op-789" })),
  requireCrdSession: vi.fn(),
}));

vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({
    adminProvisionTenant: mocks.adminProvisionTenant,
    adminUpdateTenant: mocks.adminUpdateTenant,
    adminDeleteTenant: mocks.adminDeleteTenant,
  }),
}));

vi.mock("../_authz", () => ({
  requireCrdSession: mocks.requireCrdSession,
}));

vi.mock("@/src/lib/audit/crd", () => ({ emitCrdAuditFromGate: vi.fn() }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  provisionTenantAction,
  updateTenantAction,
  deleteTenantAction,
} from "../tenant";

beforeEach(() => {
  mocks.adminProvisionTenant.mockReset();
  mocks.adminProvisionTenant.mockResolvedValue({ opId: "op-123" });
  mocks.adminUpdateTenant.mockReset();
  mocks.adminUpdateTenant.mockResolvedValue({ opId: "op-456" });
  mocks.adminDeleteTenant.mockReset();
  mocks.adminDeleteTenant.mockResolvedValue({ opId: "op-789" });
  // Authz gate: allow.
  mocks.requireCrdSession.mockResolvedValue({
    ok: true,
    session: { user: { id: "admin" } },
    userId: "admin",
  });
});

describe("provisionTenantAction", () => {
  it("enqueues AdminProvisionTenant with the slugified id + spec and returns op_id", async () => {
    const r = await provisionTenantAction({
      displayName: "Acme Corp",
      owner: "alice@acme.io",
      tier: "org",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({
      name: "acme-corp",
      namespace: "tenant-acme-corp",
      opId: "op-123",
    });
    expect(mocks.adminProvisionTenant).toHaveBeenCalledOnce();
    expect(mocks.adminProvisionTenant).toHaveBeenCalledWith({
      tenantId: "acme-corp",
      displayName: "Acme Corp",
      ownerEmail: "alice@acme.io",
      tier: "org",
    });
  });

  it("defaults tier to 'team' when unset (matching the legacy `?? team`)", async () => {
    const r = await provisionTenantAction({ displayName: "Beta", owner: "b@x.io" });
    expect(r.ok).toBe(true);
    expect(mocks.adminProvisionTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "beta", tier: "team" }),
    );
  });

  it("rejects an empty display name as BAD_INPUT without an RPC", async () => {
    const r = await provisionTenantAction({ displayName: "", owner: "" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BAD_INPUT");
    expect(mocks.adminProvisionTenant).not.toHaveBeenCalled();
  });

  it("maps a PermissionDenied RPC error to FORBIDDEN", async () => {
    mocks.adminProvisionTenant.mockRejectedValueOnce(
      new ConnectError("nope", Code.PermissionDenied),
    );
    const r = await provisionTenantAction({ displayName: "Gamma", owner: "g@x.io" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("FORBIDDEN");
  });
});

describe("updateTenantAction", () => {
  it("sends only tier when the patch sets tier alone (display_name_set=false)", async () => {
    const r = await updateTenantAction("acme", { tier: "enterprise" });
    expect(r.ok).toBe(true);
    expect(mocks.adminUpdateTenant).toHaveBeenCalledWith({
      tenantId: "acme",
      tier: "enterprise",
      tierSet: true,
      displayName: "",
      displayNameSet: false,
    });
  });

  it("sends only display_name when the patch sets displayName alone (tier_set=false)", async () => {
    const r = await updateTenantAction("acme", { displayName: "Acme Inc" });
    expect(r.ok).toBe(true);
    expect(mocks.adminUpdateTenant).toHaveBeenCalledWith({
      tenantId: "acme",
      tier: "",
      tierSet: false,
      displayName: "Acme Inc",
      displayNameSet: true,
    });
  });

  it("rejects an invalid tier as BAD_INPUT without an RPC", async () => {
    const r = await updateTenantAction("acme", {
      tier: "bogus" as unknown as "team",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BAD_INPUT");
    expect(mocks.adminUpdateTenant).not.toHaveBeenCalled();
  });
});

describe("deleteTenantAction", () => {
  it("enqueues AdminDeleteTenant when the confirmation matches", async () => {
    const r = await deleteTenantAction("acme", "acme");
    expect(r.ok).toBe(true);
    expect(mocks.adminDeleteTenant).toHaveBeenCalledWith({ tenantId: "acme" });
  });

  it("rejects a mismatched confirmation as BAD_INPUT without an RPC", async () => {
    const r = await deleteTenantAction("acme", "wrong");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("BAD_INPUT");
    expect(mocks.adminDeleteTenant).not.toHaveBeenCalled();
  });

  it("maps a NotFound RPC error to NOT_FOUND", async () => {
    mocks.adminDeleteTenant.mockRejectedValueOnce(
      new ConnectError("gone", Code.NotFound),
    );
    const r = await deleteTenantAction("acme", "acme");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("NOT_FOUND");
  });
});
