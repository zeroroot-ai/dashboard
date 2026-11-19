// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

const client = {
  listOutsideAgents: vi.fn(),
  getOutsideAgent: vi.fn(),
  registerOutsideAgent: vi.fn(),
  deleteOutsideAgent: vi.fn(),
  grantOutsideAgent: vi.fn(),
  revokeOutsideAgent: vi.fn(),
  listOutsideAgentGrants: vi.fn(),
};
vi.mock("@/src/lib/gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("../../gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("@/src/gen/gibson/tenant/v1/outside_agent_pb", () => ({ OutsideAgentService: {} }));

import {
  daemonDeleteOutsideAgent,
  daemonGetOutsideAgent,
  daemonGrantOutsideAgent,
  daemonListOutsideAgentGrants,
  daemonListOutsideAgents,
  daemonRegisterOutsideAgent,
  daemonRevokeOutsideAgent,
} from "../outside-agents";

const PROTO = {
  name: "scout",
  a2aUrl: "https://agent.example.com/a2a",
  credentialSecret: "cred",
  caBundleSecret: "",
  description: "d",
  createdAt: { seconds: BigInt(1_700_000_000), nanos: 0 },
};
const DTO = { ...PROTO, createdAt: "2023-11-14T22:13:20.000Z" };

beforeEach(() => vi.clearAllMocks());

describe("outside agent client", () => {
  it("reports a grant list that the walk cut at its page bound", async () => {
    let page = 0;
    client.listOutsideAgentGrants.mockImplementation(async () => {
      page++;
      return { missionIds: [`m${page}`], nextPageToken: `p${page + 1}` };
    });
    const out = await daemonListOutsideAgentGrants("scout");
    expect(out.truncated).toBe(true);
    expect(out.items).toHaveLength(10);
  });

  it("lists and maps the entries, and maps a missing time to an empty text", async () => {
    client.listOutsideAgents.mockResolvedValue({ entries: [PROTO, { ...PROTO, createdAt: undefined }] });
    const out = await daemonListOutsideAgents();
    expect(out[0]).toEqual(DTO);
    expect(out[1].createdAt).toBe("");
  });

  it("reads each page of the outside agent list", async () => {
    client.listOutsideAgents
      .mockResolvedValueOnce({ entries: [PROTO], nextPageToken: "p2" })
      .mockResolvedValueOnce({ entries: [{ ...PROTO, name: "relay" }], nextPageToken: "" });
    const out = await daemonListOutsideAgents();
    expect(out.map((e) => e.name)).toEqual(["scout", "relay"]);
    expect(client.listOutsideAgents).toHaveBeenCalledTimes(2);
    expect(client.listOutsideAgents).toHaveBeenNthCalledWith(1, { pageSize: 1000, pageToken: "" });
    expect(client.listOutsideAgents).toHaveBeenNthCalledWith(2, { pageSize: 1000, pageToken: "p2" });
  });

  it("reads one by name, and returns null when the entry is missing", async () => {
    client.getOutsideAgent.mockResolvedValueOnce({ entry: PROTO }).mockResolvedValueOnce({ entry: undefined });
    expect(await daemonGetOutsideAgent("scout")).toEqual(DTO);
    expect(client.getOutsideAgent).toHaveBeenCalledWith({ name: "scout" });
    expect(await daemonGetOutsideAgent("x")).toBeNull();
  });

  it("registers with the secret names and no secret value", async () => {
    client.registerOutsideAgent.mockResolvedValue({ entry: PROTO });
    const input = {
      name: "scout",
      a2aUrl: "https://agent.example.com/a2a",
      credentialSecret: "cred",
      caBundleSecret: "ca",
      description: "d",
    };
    expect(await daemonRegisterOutsideAgent(input)).toEqual(DTO);
    expect(client.registerOutsideAgent).toHaveBeenCalledWith(input);
  });

  it("lets a validation error reach the caller unchanged", async () => {
    const err = new ConnectError("the host resolves to a private address", Code.InvalidArgument);
    client.registerOutsideAgent.mockRejectedValue(err);
    await expect(
      daemonRegisterOutsideAgent({ name: "a", a2aUrl: "https://x", credentialSecret: "", caBundleSecret: "", description: "" }),
    ).rejects.toBe(err);
  });

  it("deletes, grants, revokes and lists grants by name and mission id", async () => {
    client.deleteOutsideAgent.mockResolvedValue({});
    client.grantOutsideAgent.mockResolvedValue({});
    client.revokeOutsideAgent.mockResolvedValue({});
    client.listOutsideAgentGrants.mockResolvedValue({ missionIds: ["m1", "m2"] });
    await daemonDeleteOutsideAgent("scout");
    await daemonGrantOutsideAgent("scout", "m1");
    await daemonRevokeOutsideAgent("scout", "m1");
    expect(await daemonListOutsideAgentGrants("scout")).toEqual({ items: ["m1", "m2"], truncated: false });
    expect(client.deleteOutsideAgent).toHaveBeenCalledWith({ name: "scout" });
    expect(client.grantOutsideAgent).toHaveBeenCalledWith({ name: "scout", missionId: "m1" });
    expect(client.revokeOutsideAgent).toHaveBeenCalledWith({ name: "scout", missionId: "m1" });
    expect(client.listOutsideAgentGrants).toHaveBeenCalledWith({ name: "scout", pageSize: 1000, pageToken: "" });
  });
});
