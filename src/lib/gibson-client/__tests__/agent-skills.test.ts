// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for gibson-client/agent-skills.ts (epic gibson#1364).
 *
 * The tests mock userClient, so no gRPC connection is needed. They check
 * that each function sends the right request, that the proto messages map to
 * the DTO shape, and that a ConnectError reaches the caller unchanged.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

const client = {
  listAgentSkills: vi.fn(),
  getAgentSkill: vi.fn(),
  publishAgentSkill: vi.fn(),
  deleteAgentSkill: vi.fn(),
  grantAgentSkill: vi.fn(),
  revokeAgentSkill: vi.fn(),
  listSharedAgentSkills: vi.fn(),
  enableSharedAgentSkill: vi.fn(),
};

vi.mock("@/src/lib/gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("../../gibson-client", () => ({ userClient: vi.fn(() => client) }));
vi.mock("@/src/gen/gibson/tenant/v1/agent_skill_pb", () => ({
  AgentSkillService: {},
  AgentSkillSubjectKind: { UNSPECIFIED: 0, AGENT: 1, MISSION: 2 },
}));

import {
  daemonDeleteAgentSkill,
  daemonEnableSharedAgentSkill,
  daemonGetAgentSkill,
  daemonGrantAgentSkill,
  daemonListAgentSkills,
  daemonListSharedAgentSkills,
  daemonPublishAgentSkill,
  daemonRevokeAgentSkill,
} from "../agent-skills";

const PROTO_ENTRY = {
  name: "triage",
  digest: "sha256:aa",
  reference: "reg.example/team/triage@sha256:aa",
  description: "Sort findings",
  license: "MIT",
  compatibility: "gibson",
  metadata: { author: "team" },
  allowedTools: ["read"],
  publishedAt: { seconds: BigInt(1_700_000_000), nanos: 500_000_000 },
  current: true,
};
const DTO_ENTRY = {
  name: "triage",
  digest: "sha256:aa",
  reference: "reg.example/team/triage@sha256:aa",
  description: "Sort findings",
  license: "MIT",
  compatibility: "gibson",
  metadata: { author: "team" },
  allowedTools: ["read"],
  publishedAt: "2023-11-14T22:13:20.500Z",
  current: true,
};

beforeEach(() => vi.clearAllMocks());

describe("daemonListAgentSkills", () => {
  it("lists the current version of each name by default", async () => {
    client.listAgentSkills.mockResolvedValue({ entries: [PROTO_ENTRY] });
    expect(await daemonListAgentSkills()).toEqual([DTO_ENTRY]);
    expect(client.listAgentSkills).toHaveBeenCalledWith({ name: "", allVersions: false });
  });

  it("asks for each version of one name", async () => {
    client.listAgentSkills.mockResolvedValue({ entries: [] });
    await daemonListAgentSkills({ name: "triage", allVersions: true });
    expect(client.listAgentSkills).toHaveBeenCalledWith({ name: "triage", allVersions: true });
  });

  it("maps a missing publish time to an empty text", async () => {
    client.listAgentSkills.mockResolvedValue({ entries: [{ ...PROTO_ENTRY, publishedAt: undefined }] });
    expect((await daemonListAgentSkills())[0].publishedAt).toBe("");
  });

  it("lets a ConnectError reach the caller unchanged", async () => {
    const err = new ConnectError("bad", Code.InvalidArgument);
    client.listAgentSkills.mockRejectedValue(err);
    await expect(daemonListAgentSkills()).rejects.toBe(err);
  });
});

describe("daemonGetAgentSkill", () => {
  it("maps the body and the files, and reads the current version for an empty digest", async () => {
    client.getAgentSkill.mockResolvedValue({
      entry: PROTO_ENTRY,
      body: "# Hello",
      files: [{ path: "scripts/run.sh", sizeBytes: BigInt(12) }],
    });
    expect(await daemonGetAgentSkill("triage")).toEqual({
      entry: DTO_ENTRY,
      body: "# Hello",
      files: [{ path: "scripts/run.sh", sizeBytes: 12 }],
    });
    expect(client.getAgentSkill).toHaveBeenCalledWith({ name: "triage", digest: "" });
  });

  it("returns null when the response holds no entry", async () => {
    client.getAgentSkill.mockResolvedValue({ entry: undefined, body: "", files: [] });
    expect(await daemonGetAgentSkill("triage", "sha256:zz")).toBeNull();
    expect(client.getAgentSkill).toHaveBeenCalledWith({ name: "triage", digest: "sha256:zz" });
  });
});

describe("daemonPublishAgentSkill", () => {
  it("sends the name, the reference and the registry secret", async () => {
    client.publishAgentSkill.mockResolvedValue({ entry: PROTO_ENTRY });
    const out = await daemonPublishAgentSkill({
      name: "triage",
      reference: "reg.example/team/triage@sha256:aa",
      registrySecret: "reg-cred",
    });
    expect(out).toEqual(DTO_ENTRY);
    expect(client.publishAgentSkill).toHaveBeenCalledWith({
      name: "triage",
      reference: "reg.example/team/triage@sha256:aa",
      registrySecret: "reg-cred",
    });
  });

  it("lets a validation error reach the caller with its message", async () => {
    const err = new ConnectError("reference must name a digest", Code.InvalidArgument);
    client.publishAgentSkill.mockRejectedValue(err);
    await expect(
      daemonPublishAgentSkill({ name: "a", reference: "r:latest", registrySecret: "" }),
    ).rejects.toMatchObject({ rawMessage: "reference must name a digest" });
  });
});

describe("delete, grant and revoke", () => {
  it("returns the count of deleted versions", async () => {
    client.deleteAgentSkill.mockResolvedValue({ deletedVersions: 3 });
    expect(await daemonDeleteAgentSkill("triage")).toBe(3);
    expect(client.deleteAgentSkill).toHaveBeenCalledWith({ name: "triage" });
  });

  it("sends the subject kind of an agent and of a mission", async () => {
    client.grantAgentSkill.mockResolvedValue({});
    client.revokeAgentSkill.mockResolvedValue({});
    await daemonGrantAgentSkill("triage", "agent", "agent-1");
    await daemonGrantAgentSkill("triage", "mission", "m-1");
    await daemonRevokeAgentSkill("triage", "agent", "agent-1");
    expect(client.grantAgentSkill).toHaveBeenNthCalledWith(1, {
      name: "triage",
      subjectKind: 1,
      subjectId: "agent-1",
    });
    expect(client.grantAgentSkill).toHaveBeenNthCalledWith(2, {
      name: "triage",
      subjectKind: 2,
      subjectId: "m-1",
    });
    expect(client.revokeAgentSkill).toHaveBeenCalledWith({
      name: "triage",
      subjectKind: 1,
      subjectId: "agent-1",
    });
  });
});

describe("Shared Agent Skills", () => {
  it("lists and maps the offered entries", async () => {
    client.listSharedAgentSkills.mockResolvedValue({
      entries: [{ name: "triage", description: "d", digest: "sha256:aa", enabled: true }],
    });
    expect(await daemonListSharedAgentSkills()).toEqual([
      { name: "triage", description: "d", digest: "sha256:aa", enabled: true },
    ]);
    expect(client.listSharedAgentSkills).toHaveBeenCalledWith({});
  });

  it("enables one by name", async () => {
    client.enableSharedAgentSkill.mockResolvedValue({ entry: PROTO_ENTRY });
    expect(await daemonEnableSharedAgentSkill("triage")).toEqual(DTO_ENTRY);
    expect(client.enableSharedAgentSkill).toHaveBeenCalledWith({ name: "triage" });
  });
});
