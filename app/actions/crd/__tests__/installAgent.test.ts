/**
 * installAgentAction unit tests — covers the happy path, the adversarial
 * manifest case (caller lacks access), and the compensating-delete rollback
 * path.
 *
 * Spec: access-matrix-finish task 23, R5 AC 4/7 + NFR Reliability.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/src/lib/auth", () => ({
  getServerSession: vi.fn(),
}));

const mockWriteAccessTuples = vi.fn();
vi.mock("@/src/lib/gibson-admin-client", () => ({
  getDaemonAdminClient: () => ({ writeAccessTuples: mockWriteAccessTuples }),
}));

const mockValidateComponent = vi.fn();
vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));
vi.mock("@connectrpc/connect", () => ({
  createClient: () => ({ validateComponent: mockValidateComponent }),
}));
vi.mock("@/src/gen/gibson/daemon/discovery/v1/discovery_pb", () => ({
  DiscoveryService: {},
}));

const mockList = vi.fn();
vi.mock("@/app/actions/read/listAccessibleComponents", () => ({
  listAccessibleComponentsAction: (...args: unknown[]) => mockList(...args),
}));

// node:crypto is real — randomUUID works under vitest/jsdom-node.

import { installAgentAction } from "../installAgent";
import { getServerSession } from "@/src/lib/auth";

function withSession(tenantId = "acme") {
  (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue({
    user: { tenantId },
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

  it("happy path writes the batched tuples", async () => {
    withSession();
    mockWriteAccessTuples.mockResolvedValue({ added: 1, deleted: 0 });

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
    expect(mockWriteAccessTuples).toHaveBeenCalledTimes(1);
    const call = mockWriteAccessTuples.mock.calls[0][0];
    expect(call.add).toHaveLength(1);
    expect(call.add[0].relation).toBe("component_execute_enabled");
    expect(call.add[0].object).toBe("component:plugin/gitlab");
    expect(call.delete).toEqual([]);
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
    expect(mockWriteAccessTuples).not.toHaveBeenCalled();
  });

  it("compensating delete fires on batch failure", async () => {
    withSession();
    // First writeAccessTuples (the add) fails; second (the rollback delete)
    // also gets called — we capture both.
    mockWriteAccessTuples
      .mockRejectedValueOnce(new Error("fga write failed after partial"))
      .mockResolvedValueOnce({ added: 0, deleted: 1 });

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
      expect(r.error).toContain("install rolled back");
    }
    expect(mockWriteAccessTuples).toHaveBeenCalledTimes(2);
    const rollback = mockWriteAccessTuples.mock.calls[1][0];
    expect(rollback.add).toEqual([]);
    expect(rollback.delete).toHaveLength(1);
    expect(rollback.delete[0].object).toBe("component:plugin/gitlab");
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
    expect(mockWriteAccessTuples).not.toHaveBeenCalled();
  });
});
