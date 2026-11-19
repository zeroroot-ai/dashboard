// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

const { inbound, identity, daemon, pick } = vi.hoisted(() => {
  const inbound = {
    listInboundMissions: vi.fn(),
    publishInboundMission: vi.fn(),
    unpublishInboundMission: vi.fn(),
    grantInboundCaller: vi.fn(),
    revokeInboundCaller: vi.fn(),
    listInboundCallers: vi.fn(),
  };
  const identity = {
    createAgentIdentity: vi.fn(),
    revokeAgentIdentity: vi.fn(),
    listAgentIdentities: vi.fn(),
  };
  const daemon = {
    listMissionDefinitions: vi.fn(),
    listTargets: vi.fn(),
    getMissionDefinition: vi.fn(),
  };
  const pick = (service: unknown) =>
    service === "inbound" ? inbound : service === "identity" ? identity : daemon;
  return { inbound, identity, daemon, pick };
});
vi.mock("@/src/lib/gibson-client", () => ({ userClient: vi.fn(pick) }));
vi.mock("../../gibson-client", () => ({ userClient: vi.fn(pick) }));
vi.mock("@/src/gen/gibson/tenant/v1/inbound_mission_pb", () => ({ InboundMissionService: "inbound" }));
vi.mock("@/src/gen/gibson/agentidentity/v1/agent_identity_pb", () => ({
  AgentIdentityService: "identity",
  PrincipalKind: { AGENT: 1 },
}));
vi.mock("@/src/gen/gibson/daemon/v1/daemon_pb", () => ({ DaemonService: "daemon" }));

import {
  INBOUND_CALLER_CEILING,
  daemonCreateInboundCallerIdentity,
  daemonGrantInboundCaller,
  daemonListDefinitionAgents,
  daemonListInboundCallerNames,
  daemonListInboundCallers,
  daemonListInboundDefinitionOptions,
  daemonListInboundMissions,
  daemonListInboundTargetOptions,
  daemonPublishInboundMission,
  daemonRevokeInboundCaller,
  daemonRevokeInboundCallerIdentity,
  daemonUnpublishInboundMission,
} from "../inbound-missions";

const PROTO = {
  agent: "recon",
  missionDefinitionId: "def-1",
  targetIds: ["t1", "t2"],
  maxActiveMissions: 3,
  publishedBy: "user-1",
  createdAt: { seconds: BigInt(1_700_000_000), nanos: 0 },
  stale: false,
  staleReason: "",
};
const DTO = { ...PROTO, createdAt: "2023-11-14T22:13:20.000Z" };

beforeEach(() => vi.clearAllMocks());

describe("inbound mission client", () => {
  it("lists and maps the entries, and maps a missing time to an empty text", async () => {
    inbound.listInboundMissions.mockResolvedValue({ entries: [PROTO, { ...PROTO, createdAt: undefined }] });
    const out = await daemonListInboundMissions();
    expect(out[0]).toEqual(DTO);
    expect(out[1].createdAt).toBe("");
  });

  it("maps the stale mark and its reason", async () => {
    inbound.listInboundMissions.mockResolvedValue({
      entries: [{ ...PROTO, stale: true, staleReason: "an approved target changed after it was published" }],
    });
    const [out] = await daemonListInboundMissions();
    expect(out.stale).toBe(true);
    expect(out.staleReason).toBe("an approved target changed after it was published");
  });

  it("reads each page of the published definitions", async () => {
    inbound.listInboundMissions
      .mockResolvedValueOnce({ entries: [PROTO], nextPageToken: "p2" })
      .mockResolvedValueOnce({ entries: [{ ...PROTO, agent: "scan" }], nextPageToken: "" });
    const out = await daemonListInboundMissions();
    expect(out.map((e) => e.agent)).toEqual(["recon", "scan"]);
    expect(inbound.listInboundMissions).toHaveBeenCalledTimes(2);
    expect(inbound.listInboundMissions).toHaveBeenNthCalledWith(1, { pageSize: 1000, pageToken: "" });
    expect(inbound.listInboundMissions).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: "p2" });
  });

  it("reads each page of the callers of one published definition", async () => {
    inbound.listInboundCallers
      .mockResolvedValueOnce({ identityIds: ["agent_principal:a"], nextPageToken: "p2" })
      .mockResolvedValueOnce({ identityIds: ["agent_principal:b"], nextPageToken: "" });
    expect(await daemonListInboundCallers("recon")).toEqual({
      items: ["agent_principal:a", "agent_principal:b"],
      truncated: false,
    });
    expect(inbound.listInboundCallers).toHaveBeenNthCalledWith(1, { agent: "recon", pageSize: 1000, pageToken: "" });
    expect(inbound.listInboundCallers).toHaveBeenNthCalledWith(2, { agent: "recon", pageSize: 1000, pageToken: "p2" });
  });

  it("reports a caller list that the walk cut at its page bound", async () => {
    let page = 0;
    inbound.listInboundCallers.mockImplementation(async () => {
      page++;
      return { identityIds: [`agent_principal:${page}`], nextPageToken: `p${page + 1}` };
    });
    const out = await daemonListInboundCallers("recon");
    expect(out.truncated).toBe(true);
    expect(out.items).toHaveLength(10);
  });

  it("publishes with the agent, the definition, the targets and the limit", async () => {
    inbound.publishInboundMission.mockResolvedValueOnce({ entry: PROTO }).mockResolvedValueOnce({ entry: undefined });
    const input = { agent: "recon", missionDefinitionId: "def-1", targetIds: ["t1", "t2"], maxActiveMissions: 3 };
    expect(await daemonPublishInboundMission(input)).toEqual(DTO);
    expect(inbound.publishInboundMission).toHaveBeenCalledWith(input);
    expect(await daemonPublishInboundMission(input)).toBeNull();
  });

  it("lets a validation error reach the caller unchanged", async () => {
    const err = new ConnectError("the definition has no agent node for the agent", Code.InvalidArgument);
    inbound.publishInboundMission.mockRejectedValue(err);
    await expect(
      daemonPublishInboundMission({ agent: "x", missionDefinitionId: "d", targetIds: ["t"], maxActiveMissions: 1 }),
    ).rejects.toBe(err);
  });

  it("unpublishes, and grants and revokes with the typed principal id unchanged", async () => {
    inbound.unpublishInboundMission.mockResolvedValue({});
    inbound.grantInboundCaller.mockResolvedValue({});
    inbound.revokeInboundCaller.mockResolvedValue({});
    await daemonUnpublishInboundMission("recon");
    await daemonGrantInboundCaller("recon", "agent_principal:id-1");
    await daemonRevokeInboundCaller("recon", "agent_principal:id-1");
    expect(inbound.unpublishInboundMission).toHaveBeenCalledWith({ agent: "recon" });
    expect(inbound.grantInboundCaller).toHaveBeenCalledWith({ agent: "recon", identityId: "agent_principal:id-1" });
    expect(inbound.revokeInboundCaller).toHaveBeenCalledWith({ agent: "recon", identityId: "agent_principal:id-1" });
  });

  it("makes a caller identity of the kind agent with only the originate ceiling and no grant", async () => {
    identity.createAgentIdentity.mockResolvedValue({
      principalId: "agent_principal:id-1",
      name: "partner",
      bootstrapToken: "tok",
      gibsonUrl: "https://gibson.example.com",
    });
    expect(await daemonCreateInboundCallerIdentity("partner")).toEqual({
      principalId: "agent_principal:id-1",
      name: "partner",
      bootstrapToken: "tok",
      gibsonUrl: "https://gibson.example.com",
    });
    expect(INBOUND_CALLER_CEILING).toBe("mission:originate");
    expect(identity.createAgentIdentity).toHaveBeenCalledWith({
      name: "partner",
      kind: 1,
      description: "Inbound A2A caller",
      componentGrants: [],
      capabilityCeiling: ["mission:originate"],
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("returns the principal of the new identity as the daemon sent it", async () => {
    identity.createAgentIdentity.mockResolvedValue({ principalId: "tool_principal:id-1", name: "partner" });
    // The identity exists now, so this function does not throw. The flow checks the type and revokes.
    expect((await daemonCreateInboundCallerIdentity("partner")).principalId).toBe("tool_principal:id-1");
  });

  it("revokes an identity by its principal", async () => {
    identity.revokeAgentIdentity.mockResolvedValue({});
    await daemonRevokeInboundCallerIdentity("agent_principal:id-1");
    expect(identity.revokeAgentIdentity).toHaveBeenCalledWith({ principalId: "agent_principal:id-1" });
  });

  it("maps each agent identity id to its name, over each page", async () => {
    identity.listAgentIdentities
      .mockResolvedValueOnce({
        identities: [{ principalId: "agent_principal:a", name: "one" }],
        nextPageToken: "p2",
      })
      .mockResolvedValueOnce({
        identities: [
          { principalId: "agent_principal:b", name: "two" },
          { principalId: "agent_principal:c", name: "" },
        ],
        nextPageToken: "",
      });
    expect(await daemonListInboundCallerNames()).toEqual({ "agent_principal:a": "one", "agent_principal:b": "two" });
    expect(identity.listAgentIdentities).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: "p2", kindFilter: 1 });
  });

  it("lists the definitions and the targets for the pickers, over each page", async () => {
    daemon.listMissionDefinitions
      .mockResolvedValueOnce({ missions: [{ missionDefinitionId: "d1", name: "recon-flow" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({
        missions: [
          { missionDefinitionId: "d2", name: "scan-flow" },
          { missionDefinitionId: "", name: "no-id" },
        ],
        nextPageToken: "",
      });
    daemon.listTargets
      .mockResolvedValueOnce({ targets: [{ id: "t1", name: "web" }], nextPageToken: "p2" })
      .mockResolvedValueOnce({ targets: [{ id: "t2", name: "" }], nextPageToken: "" });
    expect(await daemonListInboundDefinitionOptions()).toEqual([
      { id: "d1", name: "recon-flow" },
      { id: "d2", name: "scan-flow" },
    ]);
    expect(await daemonListInboundTargetOptions()).toEqual([
      { id: "t1", name: "web" },
      { id: "t2", name: "t2" },
    ]);
    expect(daemon.listTargets).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: "p2" });
  });

  it("reads the agent names of the agent nodes of a definition", async () => {
    daemon.getMissionDefinition.mockResolvedValue({
      definition: {
        nodes: {
          n1: { config: { case: "agentConfig", value: { agentName: "scan" } } },
          n2: { config: { case: "toolConfig", value: { toolName: "nmap" } } },
          n3: { config: { case: "agentConfig", value: { agentName: "recon" } } },
          n4: { config: { case: "agentConfig", value: { agentName: "recon" } } },
        },
      },
    });
    expect(await daemonListDefinitionAgents("recon-flow")).toEqual(["recon", "scan"]);
    expect(daemon.getMissionDefinition).toHaveBeenCalledWith({ name: "recon-flow" });
  });
});
