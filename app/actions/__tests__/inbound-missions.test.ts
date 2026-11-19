// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  publish: vi.fn(),
  unpublish: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  callers: vi.fn(),
  names: vi.fn(),
  create: vi.fn(),
  retire: vi.fn(),
  definitions: vi.fn(),
  targets: vi.fn(),
  agents: vi.fn(),
  session: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: m.session }));
vi.mock("@/src/lib/gibson-client/inbound-missions", () => ({
  daemonListInboundMissions: m.list,
  daemonPublishInboundMission: m.publish,
  daemonUnpublishInboundMission: m.unpublish,
  daemonGrantInboundCaller: m.grant,
  daemonRevokeInboundCaller: m.revoke,
  daemonListInboundCallers: m.callers,
  daemonListInboundCallerNames: m.names,
  daemonCreateInboundCallerIdentity: m.create,
  daemonRevokeInboundCallerIdentity: m.retire,
  daemonListInboundDefinitionOptions: m.definitions,
  daemonListInboundTargetOptions: m.targets,
  daemonListDefinitionAgents: m.agents,
}));

import {
  addInboundCallerAction,
  listDefinitionAgentsAction,
  listInboundCallersAction,
  listInboundMissionsAction,
  listInboundPublishOptionsAction,
  publishInboundMissionAction,
  republishInboundMissionAction,
  revokeInboundCallerAction,
  unpublishInboundMissionAction,
} from "../inbound-missions";

const VALID = {
  agent: "recon",
  missionDefinitionId: "def-1",
  targetIds: ["t1", "t2"],
  maxActiveMissions: 3,
  callerName: "partner",
};
const IDENTITY = {
  principalId: "agent_principal:id-1",
  name: "partner",
  bootstrapToken: "tok",
  gibsonUrl: "https://gibson.example.com",
};

/** The order of the daemon calls of the flow. */
function order(): string[] {
  const calls: [string, number][] = [
    ["create", m.create.mock.invocationCallOrder[0]],
    ["publish", m.publish.mock.invocationCallOrder[0]],
    ["grant", m.grant.mock.invocationCallOrder[0]],
    ["retire", m.retire.mock.invocationCallOrder[0]],
  ];
  return calls
    .filter(([, n]) => n !== undefined)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
  m.create.mockResolvedValue(IDENTITY);
  m.publish.mockResolvedValue({ agent: "recon" });
  m.grant.mockResolvedValue(undefined);
  m.retire.mockResolvedValue(undefined);
});

describe("inbound mission actions", () => {
  it("need a session and call nothing without one", async () => {
    m.session.mockResolvedValue(null);
    expect(await listInboundMissionsAction()).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await publishInboundMissionAction(VALID)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await addInboundCallerAction({ agent: "recon", callerName: "partner" })).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
    expect(m.list).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
  });

  it("list the published definitions, the options and the agents of a definition", async () => {
    m.list.mockResolvedValue([{ agent: "recon" }]);
    m.definitions.mockResolvedValue([{ id: "def-1", name: "recon-flow" }]);
    m.targets.mockResolvedValue([{ id: "t1", name: "web" }]);
    m.agents.mockResolvedValue(["recon"]);
    expect(await listInboundMissionsAction()).toEqual({ ok: true, data: [{ agent: "recon" }] });
    expect(await listInboundPublishOptionsAction()).toEqual({
      ok: true,
      data: { definitions: [{ id: "def-1", name: "recon-flow" }], targets: [{ id: "t1", name: "web" }] },
    });
    expect(await listDefinitionAgentsAction(" recon-flow ")).toEqual({ ok: true, data: ["recon"] });
    expect(m.agents).toHaveBeenCalledWith("recon-flow");
  });

  it("list the callers with the name of each identity", async () => {
    m.callers.mockResolvedValue(["agent_principal:id-1", "agent_principal:id-2"]);
    m.names.mockResolvedValue({ "agent_principal:id-1": "partner" });
    expect(await listInboundCallersAction("recon")).toEqual({
      ok: true,
      data: [
        { identityId: "agent_principal:id-1", name: "partner" },
        { identityId: "agent_principal:id-2", name: "" },
      ],
    });
    expect(m.callers).toHaveBeenCalledWith("recon");
  });

  it("unpublish and revoke by agent and identity id", async () => {
    expect(await unpublishInboundMissionAction(" recon ")).toEqual({ ok: true, data: null });
    expect(m.unpublish).toHaveBeenCalledWith("recon");
    expect(await revokeInboundCallerAction({ agent: "recon", identityId: " agent_principal:id-1 " })).toEqual({ ok: true, data: null });
    expect(m.revoke).toHaveBeenCalledWith("recon", "agent_principal:id-1");
    expect(await revokeInboundCallerAction({ agent: "recon", identityId: "" })).toMatchObject({ code: "bad_input" });
  });

  it("show the text of a daemon refusal", async () => {
    m.unpublish.mockRejectedValue(new ConnectError("the agent is not published", Code.NotFound));
    expect(await unpublishInboundMissionAction("recon")).toEqual({
      ok: false,
      error: "the agent is not published",
      code: "not_found",
    });
  });
});

describe("the publish flow", () => {
  it.each([
    [{ agent: "Bad_Name" }, /lowercase/i],
    [{ callerName: "" }, /required/i],
    [{ missionDefinitionId: " " }, /required/i],
    [{ targetIds: [] }, /at least one target/i],
    [{ targetIds: ["t1", "t1"] }, /two times/i],
    [{ maxActiveMissions: 0 }, /at least 1/i],
    [{ maxActiveMissions: 1.5 }, /whole number/i],
    [{ maxActiveMissions: Number.NaN }, /maximum number of missions/i],
    [{ maxActiveMissions: 10001 }, /at most 10000/i],
  ])("refuses the input %j and calls nothing", async (patch, message) => {
    const r = await publishInboundMissionAction({ ...VALID, ...patch });
    expect(r).toMatchObject({ ok: false, code: "bad_input" });
    expect(r.ok ? "" : r.error).toMatch(message);
    expect(order()).toEqual([]);
  });

  it("makes the identity, then publishes, then grants, and returns the token one time", async () => {
    const r = await publishInboundMissionAction({ ...VALID, agent: " recon ", callerName: " partner " });
    expect(order()).toEqual(["create", "publish", "grant"]);
    expect(m.create).toHaveBeenCalledWith("partner");
    expect(m.publish).toHaveBeenCalledWith({
      agent: "recon",
      missionDefinitionId: "def-1",
      targetIds: ["t1", "t2"],
      maxActiveMissions: 3,
    });
    expect(m.grant).toHaveBeenCalledWith("recon", "agent_principal:id-1");
    expect(m.retire).not.toHaveBeenCalled();
    expect(r).toEqual({
      ok: true,
      caller: { identityId: "agent_principal:id-1", name: "partner" },
      credentials: { bootstrapToken: "tok", gibsonUrl: "https://gibson.example.com" },
    });
  });

  it("stops when the identity is not made, and makes nothing", async () => {
    m.create.mockRejectedValue(new ConnectError("an agent with that name exists", Code.AlreadyExists));
    const r = await publishInboundMissionAction(VALID);
    expect(order()).toEqual(["create"]);
    expect(r).toEqual({
      ok: false,
      error: "an agent with that name exists",
      code: "already_exists",
      failedStep: "identity",
      published: false,
    });
  });

  it("revokes the new identity when the publish fails, and returns no token", async () => {
    m.publish.mockRejectedValue(new ConnectError("the definition has no agent node", Code.InvalidArgument));
    const r = await publishInboundMissionAction(VALID);
    expect(order()).toEqual(["create", "publish", "retire"]);
    expect(m.retire).toHaveBeenCalledWith("agent_principal:id-1");
    expect(r).toEqual({
      ok: false,
      error: "the definition has no agent node",
      code: "invalid_argument",
      failedStep: "publish",
      identity: { identityId: "agent_principal:id-1", name: "partner", removed: true },
      published: false,
    });
    expect(JSON.stringify(r)).not.toContain("tok");
  });

  it("keeps the publication and revokes the identity when the grant fails", async () => {
    m.grant.mockRejectedValue(new ConnectError("the identity is not of this tenant", Code.NotFound));
    const r = await publishInboundMissionAction(VALID);
    expect(order()).toEqual(["create", "publish", "grant", "retire"]);
    expect(r).toMatchObject({
      ok: false,
      failedStep: "grant",
      identity: { identityId: "agent_principal:id-1", name: "partner", removed: true },
      published: true,
    });
    expect(JSON.stringify(r)).not.toContain("tok");
  });

  it("reports an identity that it could not revoke", async () => {
    m.publish.mockRejectedValue(new ConnectError("refused", Code.InvalidArgument));
    m.retire.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    const r = await publishInboundMissionAction(VALID);
    expect(r).toMatchObject({
      ok: false,
      failedStep: "publish",
      identity: { identityId: "agent_principal:id-1", name: "partner", removed: false },
      published: false,
    });
  });
});

describe("publish again", () => {
  const AGAIN = { agent: "recon", missionDefinitionId: "def-1", targetIds: ["t1", "t2"], maxActiveMissions: 3 };

  it("publishes the same fields, and makes no identity and no grant", async () => {
    m.publish.mockResolvedValue({ agent: "recon", stale: false });
    expect(await republishInboundMissionAction(AGAIN)).toEqual({ ok: true, data: { agent: "recon", stale: false } });
    expect(m.publish).toHaveBeenCalledWith(AGAIN);
    expect(order()).toEqual(["publish"]);
  });

  it("shows the refusal of the daemon, for example a target that was deleted", async () => {
    m.publish.mockRejectedValue(new ConnectError("the target does not exist: t2", Code.NotFound));
    expect(await republishInboundMissionAction(AGAIN)).toEqual({
      ok: false,
      error: "the target does not exist: t2",
      code: "not_found",
    });
  });

  it("refuses an empty target list or no limit, and calls nothing", async () => {
    expect(await republishInboundMissionAction({ ...AGAIN, targetIds: [] })).toMatchObject({ code: "bad_input" });
    expect(await republishInboundMissionAction({ ...AGAIN, maxActiveMissions: 0 })).toMatchObject({ code: "bad_input" });
    expect(m.publish).not.toHaveBeenCalled();
  });
});

describe("the flow that adds a caller", () => {
  it("makes the identity, then grants, and does not publish", async () => {
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(order()).toEqual(["create", "grant"]);
    expect(m.create).toHaveBeenCalledWith("second");
    expect(r).toMatchObject({ ok: true, credentials: { bootstrapToken: "tok" } });
  });

  it("revokes the new identity when the grant fails, and the definition stays published", async () => {
    m.grant.mockRejectedValue(new ConnectError("the agent is not published", Code.NotFound));
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(order()).toEqual(["create", "grant", "retire"]);
    expect(r).toMatchObject({
      ok: false,
      failedStep: "grant",
      identity: { identityId: "agent_principal:id-1", removed: true },
      published: true,
    });
  });
});
