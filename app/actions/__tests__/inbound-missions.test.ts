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
  walk: vi.fn(),
  assert: vi.fn(),
}));
vi.mock("@/src/lib/auth/assert-authorized", async (orig) => ({
  ...(await orig<typeof import("@/src/lib/auth/assert-authorized")>()),
  assertAuthorized: m.assert,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: m.session }));
vi.mock("@/src/lib/gibson-client/inbound-missions", () => ({
  AGENT_PRINCIPAL_PREFIX: "agent_principal:",
  daemonListInboundMissions: m.list,
  daemonWalkInboundMissions: m.walk,
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

import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";
import { REVOKE_CLEANUP_NOTE } from "@/src/lib/inbound-missions/revoke-note";
import {
  addInboundCallerAction,
  listDefinitionAgentsAction,
  listInboundCallersAction,
  listInboundMissionsAction,
  listInboundPublishOptionsAction,
  publishInboundMissionAction,
  republishInboundMissionAction,
  retryRevokeInboundCallerIdentityAction,
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
  m.assert.mockResolvedValue(undefined);
  m.list.mockResolvedValue([]);
  m.walk.mockResolvedValue({ items: [], truncated: false });
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
    m.callers.mockResolvedValue({ items: ["agent_principal:id-1", "agent_principal:id-2"], truncated: true });
    m.names.mockResolvedValue({ "agent_principal:id-1": "partner" });
    expect(await listInboundCallersAction("recon")).toEqual({
      ok: true,
      data: {
        items: [
          { identityId: "agent_principal:id-1", name: "partner" },
          { identityId: "agent_principal:id-2", name: "" },
        ],
        truncated: true,
      },
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

  it("refuses an agent that is already published, before it makes an identity", async () => {
    m.walk.mockResolvedValue({
      items: [{ agent: "recon", missionDefinitionId: "def-1", targetIds: ["t1", "t2"], stale: true }],
      truncated: false,
    });
    const r = await publishInboundMissionAction(VALID);
    expect(r).toMatchObject({ ok: false, code: "already_published" });
    expect(r.ok ? "" : r.error).toMatch(/already published.*Publish again.*unpublish/i);
    expect(order()).toEqual([]);
  });

  it("publishes an agent name that another publication does not use", async () => {
    m.walk.mockResolvedValue({ items: [{ agent: "scan" }], truncated: false });
    expect(await publishInboundMissionAction(VALID)).toMatchObject({ ok: true });
    expect(m.walk.mock.invocationCallOrder[0]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
  });

  it("makes no identity when it cannot read the published definitions", async () => {
    m.walk.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    const r = await publishInboundMissionAction(VALID);
    expect(r.ok).toBe(false);
    expect(order()).toEqual([]);
  });

  it("refuses when the list of published definitions is cut at the page bound", async () => {
    // The agent can be past the bound, so its absence in the rows proves nothing.
    m.walk.mockResolvedValue({ items: [{ agent: "scan" }], truncated: true });
    const r = await publishInboundMissionAction(VALID);
    expect(r).toMatchObject({ ok: false, code: "list_incomplete" });
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

  it("revokes a new principal that is not an agent identity, and reports it as made", async () => {
    m.create.mockResolvedValue({ ...IDENTITY, principalId: "tool_principal:id-1" });
    const r = await publishInboundMissionAction(VALID);
    expect(order()).toEqual(["create", "retire"]);
    expect(m.retire).toHaveBeenCalledWith("tool_principal:id-1");
    expect(r).toMatchObject({
      ok: false,
      failedStep: "identity",
      identity: { identityId: "tool_principal:id-1", name: "partner", removed: true },
      published: false,
    });
    expect(JSON.stringify(r)).not.toContain("tok");
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

describe("a grant that the daemon aborts", () => {
  const aborted = () => new ConnectError("the publication changed, row version 7 of shard pg-2", Code.Aborted);

  it("sends the grant one more time, and finishes when the second grant passes", async () => {
    m.grant.mockRejectedValueOnce(aborted()).mockResolvedValueOnce(undefined);
    const r = await publishInboundMissionAction(VALID);
    expect(m.grant).toHaveBeenCalledTimes(2);
    expect(m.retire).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, credentials: { bootstrapToken: "tok" } });
  });

  it("stops after the second abort with a fixed message, and revokes the identity", async () => {
    m.grant.mockRejectedValue(aborted());
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(m.grant).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({
      ok: false,
      error: "The publication changed during the grant. Try again.",
      code: "aborted",
      failedStep: "grant",
      identity: { removed: true },
    });
    expect(JSON.stringify(r)).not.toMatch(/row version|pg-2/);
  });

  it("does not send the grant again after another error", async () => {
    m.grant.mockRejectedValue(new ConnectError("the identity holds another grant", Code.FailedPrecondition));
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(m.grant).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, error: "the identity holds another grant", code: "failed_precondition" });
  });
});

describe("a revoke of the new identity that does not finish", () => {
  const NOTE =
    "the identity is revoked and its access is blocked, but the cleanup of its permission tuples did not finish. Retry the revoke to finish the cleanup";

  it("gives the fixed note for the cleanup message of the daemon", async () => {
    m.publish.mockRejectedValue(new ConnectError("refused", Code.InvalidArgument));
    m.retire.mockRejectedValue(new ConnectError(NOTE, Code.Unavailable));
    const r = await publishInboundMissionAction(VALID);
    expect(r).toMatchObject({
      ok: false,
      failedStep: "publish",
      identity: {
        identityId: "agent_principal:id-1",
        name: "partner",
        removed: false,
        revokeNote: REVOKE_CLEANUP_NOTE,
      },
    });
  });

  it("gives no note and no text for another Unavailable, for example from the proxy", async () => {
    m.publish.mockRejectedValue(new ConnectError("refused", Code.InvalidArgument));
    m.retire.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    const r = await publishInboundMissionAction(VALID);
    expect(r.ok ? null : r.identity).toEqual({ identityId: "agent_principal:id-1", name: "partner", removed: false });
    expect(JSON.stringify(r)).not.toContain("down");
    m.retire.mockRejectedValue(
      new ConnectError("upstream connect error or disconnect/reset before headers. reset reason: 10.0.3.4", Code.Unavailable),
    );
    expect(JSON.stringify(await publishInboundMissionAction(VALID))).not.toMatch(/upstream|10\.0\.3\.4/);
  });

  it("passes on no text of another failure of the revoke", async () => {
    m.publish.mockRejectedValue(new ConnectError("refused", Code.InvalidArgument));
    m.retire.mockRejectedValue(new ConnectError("pq: connection refused", Code.Internal));
    const r = await publishInboundMissionAction(VALID);
    expect(r.ok ? null : r.identity).toEqual({ identityId: "agent_principal:id-1", name: "partner", removed: false });
  });
});

describe("a caller who is not a tenant admin", () => {
  const PUBLISH = "/gibson.tenant.v1.InboundMissionService/PublishInboundMission";
  const GRANT = "/gibson.tenant.v1.InboundMissionService/GrantInboundCaller";
  const denyAll = () => m.assert.mockRejectedValue(new AuthzDeniedError(PUBLISH, "relation-not-met"));

  it("gets no identity made by the publish flow", async () => {
    denyAll();
    const r = await publishInboundMissionAction(VALID);
    expect(r).toEqual({ ok: false, error: "Permission denied", code: "permission_denied" });
    expect(order()).toEqual([]);
    expect(m.assert).toHaveBeenCalledWith(PUBLISH);
  });

  it("gets no identity made by the flow that adds a caller", async () => {
    denyAll();
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(r).toMatchObject({ ok: false, code: "permission_denied" });
    expect(order()).toEqual([]);
  });

  it("is checked only for the grant by the flow that adds a caller", async () => {
    // A caller with the grant right and no publish right can add a caller.
    m.assert.mockImplementation(async (method: string) => {
      if (method === PUBLISH) throw new AuthzDeniedError(PUBLISH, "relation-not-met");
    });
    const r = await addInboundCallerAction({ agent: "recon", callerName: "second" });
    expect(m.assert.mock.calls.map((c) => c[0])).toEqual([GRANT]);
    expect(r).toMatchObject({ ok: true });
    expect(order()).toEqual(["create", "grant"]);
  });

  it("is checked for the publish and for the grant before the create", async () => {
    await publishInboundMissionAction(VALID);
    expect(m.assert.mock.calls.map((c) => c[0])).toEqual([PUBLISH, GRANT]);
    expect(m.assert.mock.invocationCallOrder[1]).toBeLessThan(m.create.mock.invocationCallOrder[0]);
  });
});

describe("the retry of the revoke of a caller identity", () => {
  const ID = "agent_principal:id-1";
  const ENVOY = "upstream connect error or disconnect/reset before headers. reset reason: 10.0.3.4:8443";

  it("revokes on the server and returns no text", async () => {
    expect(await retryRevokeInboundCallerIdentityAction(` ${ID} `)).toEqual({ ok: true, data: null });
    expect(m.retire).toHaveBeenCalledWith(ID);
  });

  it("returns only a fixed text for a proxy error, for each code", async () => {
    for (const code of [Code.Unavailable, Code.Internal, Code.Unknown, Code.DeadlineExceeded]) {
      m.retire.mockRejectedValue(new ConnectError(ENVOY, code));
      const r = await retryRevokeInboundCallerIdentityAction(ID);
      expect(r).toEqual({ ok: false, error: "The identity was not revoked.", code: "revoke_failed" });
      expect(JSON.stringify(r)).not.toMatch(/upstream|10\.0\.3\.4/);
    }
    m.retire.mockRejectedValue(new Error(ENVOY));
    expect(JSON.stringify(await retryRevokeInboundCallerIdentityAction(ID))).not.toMatch(/upstream|10\.0\.3\.4/);
  });

  it("returns the fixed note for the cleanup message of the daemon", async () => {
    m.retire.mockRejectedValue(
      new ConnectError("the cleanup did not finish at 10.0.3.4. Retry the revoke to finish the cleanup", Code.Unavailable),
    );
    expect(await retryRevokeInboundCallerIdentityAction(ID)).toEqual({
      ok: false,
      error: REVOKE_CLEANUP_NOTE,
      code: "cleanup_unfinished",
    });
  });

  it("counts an identity that is gone as revoked", async () => {
    m.retire.mockRejectedValue(new ConnectError("not found", Code.NotFound));
    expect(await retryRevokeInboundCallerIdentityAction(ID)).toEqual({ ok: true, data: null });
  });

  it("refuses a principal that is not an agent identity, and needs a session", async () => {
    expect(await retryRevokeInboundCallerIdentityAction("user:alice")).toMatchObject({ code: "bad_input" });
    expect(await retryRevokeInboundCallerIdentityAction("agent_principal:")).toMatchObject({ code: "bad_input" });
    m.session.mockResolvedValue(null);
    expect(await retryRevokeInboundCallerIdentityAction(ID)).toMatchObject({ code: "unauthenticated" });
    expect(m.retire).not.toHaveBeenCalled();
  });
});

describe("publish again", () => {
  const STORED = {
    agent: "recon",
    missionDefinitionId: "def-1",
    targetIds: ["t1", "t2"],
    maxActiveMissions: 3,
    stale: true,
    staleReason: "an approved target changed after it was published",
  };

  it("sends the stored definition, targets and limit, and makes no identity and no grant", async () => {
    m.walk.mockResolvedValue({ items: [{ ...STORED, agent: "scan" }, STORED], truncated: false });
    m.publish.mockResolvedValue({ agent: "recon", stale: false });
    expect(await republishInboundMissionAction(" recon ")).toEqual({
      ok: true,
      data: { agent: "recon", stale: false },
    });
    expect(m.publish).toHaveBeenCalledWith({
      agent: "recon",
      missionDefinitionId: "def-1",
      targetIds: ["t1", "t2"],
      maxActiveMissions: 3,
    });
    expect(order()).toEqual(["publish"]);
  });

  it("ignores a definition, a target list and a limit that the browser sends", async () => {
    m.walk.mockResolvedValue({ items: [STORED], truncated: false });
    m.publish.mockResolvedValue({ agent: "recon" });
    const forged = {
      agent: "recon",
      missionDefinitionId: "def-evil",
      targetIds: ["t-evil"],
      maxActiveMissions: 10000,
    };
    // A direct call can pass any value. The action takes the agent name only.
    const call = republishInboundMissionAction as unknown as (input: unknown) => Promise<{ ok: boolean }>;
    expect(await call(forged)).toMatchObject({ ok: false, code: "bad_input" });
    expect(m.publish).not.toHaveBeenCalled();
    await republishInboundMissionAction("recon");
    expect(m.publish).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(m.publish.mock.calls[0])).not.toMatch(/def-evil|t-evil|10000/);
  });

  it("refuses a publication that is not stale, and one that does not exist", async () => {
    m.walk.mockResolvedValue({ items: [{ ...STORED, stale: false, staleReason: "" }], truncated: false });
    expect(await republishInboundMissionAction("recon")).toMatchObject({ ok: false, code: "not_stale" });
    expect(await republishInboundMissionAction("scan")).toMatchObject({ ok: false, code: "not_found" });
    m.walk.mockResolvedValue({ items: [], truncated: true });
    expect(await republishInboundMissionAction("recon")).toMatchObject({ ok: false, code: "list_incomplete" });
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("shows the refusal of the daemon, for example a target that was deleted", async () => {
    m.walk.mockResolvedValue({ items: [STORED], truncated: false });
    m.publish.mockRejectedValue(new ConnectError("the target does not exist: t2", Code.NotFound));
    expect(await republishInboundMissionAction("recon")).toEqual({
      ok: false,
      error: "the target does not exist: t2",
      code: "not_found",
    });
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
