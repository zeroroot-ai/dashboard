// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for app/actions/agent-skills.ts. The tests mock the
 * gibson-client module and the session. They check the session floor, the
 * input checks, the pass-through of a daemon validation error, and that an
 * internal failure does not show its text.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  publish: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  session: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: m.session }));
vi.mock("@/src/lib/gibson-client/agent-skills", () => ({
  daemonListAgentSkills: m.list,
  daemonPublishAgentSkill: m.publish,
  daemonGrantAgentSkill: m.grant,
  daemonRevokeAgentSkill: m.revoke,
  daemonDeleteAgentSkill: vi.fn(),
  daemonEnableSharedAgentSkill: vi.fn(),
  daemonGetAgentSkill: vi.fn(),
  daemonListSharedAgentSkills: vi.fn(),
}));

import {
  grantAgentSkillAction,
  listAgentSkillsAction,
  publishAgentSkillAction,
  revokeAgentSkillAction,
} from "../agent-skills";

const REF = `reg.example/team/triage@sha256:${"a".repeat(64)}`;

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
});

describe("the session floor", () => {
  it("returns unauthenticated and calls nothing when there is no session", async () => {
    m.session.mockResolvedValue(null);
    expect(await listAgentSkillsAction()).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await publishAgentSkillAction({ name: "a", reference: REF, registrySecret: "" })).toMatchObject({
      ok: false,
      code: "unauthenticated",
    });
    expect(m.list).not.toHaveBeenCalled();
    expect(m.publish).not.toHaveBeenCalled();
  });
});

describe("publishAgentSkillAction", () => {
  it("trims the input and sends it", async () => {
    m.publish.mockResolvedValue({ name: "triage" });
    const r = await publishAgentSkillAction({
      name: "  triage ",
      reference: ` ${REF} `,
      registrySecret: " reg-cred ",
    });
    expect(r).toEqual({ ok: true, data: { name: "triage" } });
    expect(m.publish).toHaveBeenCalledWith({
      name: "triage",
      reference: REF,
      registrySecret: "reg-cred",
    });
  });

  it("refuses an empty name and a long name before the call", async () => {
    expect(await publishAgentSkillAction({ name: "", reference: REF, registrySecret: "" })).toMatchObject({
      ok: false,
      code: "bad_input",
    });
    expect(
      await publishAgentSkillAction({ name: "x".repeat(65), reference: REF, registrySecret: "" }),
    ).toMatchObject({ ok: false, code: "bad_input" });
    expect(m.publish).not.toHaveBeenCalled();
  });

  it("leaves the check of the digest to the daemon and shows its error", async () => {
    m.publish.mockRejectedValue(
      new ConnectError("reference uses a tag, use a digest", Code.InvalidArgument),
    );
    const r = await publishAgentSkillAction({
      name: "triage",
      reference: "reg.example/team/triage:latest",
      registrySecret: "",
    });
    expect(m.publish).toHaveBeenCalled();
    expect(r).toEqual({
      ok: false,
      error: "reference uses a tag, use a digest",
      code: "invalid_argument",
    });
  });

  it("does not show the text of an internal failure", async () => {
    m.publish.mockRejectedValue(new ConnectError("dial tcp 10.0.0.4:5432: refused", Code.Internal));
    const r = await publishAgentSkillAction({ name: "a", reference: REF, registrySecret: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain("10.0.0.4");
  });
});

describe("grant and revoke", () => {
  it("send the kind and the id", async () => {
    m.grant.mockResolvedValue(undefined);
    m.revoke.mockResolvedValue(undefined);
    expect(await grantAgentSkillAction({ name: "a", subjectKind: "agent", subjectId: " ag-1 " })).toEqual({
      ok: true,
      data: null,
    });
    expect(await revokeAgentSkillAction({ name: "a", subjectKind: "mission", subjectId: "m-1" })).toEqual({
      ok: true,
      data: null,
    });
    expect(m.grant).toHaveBeenCalledWith("a", "agent", "ag-1");
    expect(m.revoke).toHaveBeenCalledWith("a", "mission", "m-1");
  });

  it("refuse an unknown kind and an empty id", async () => {
    expect(await grantAgentSkillAction({ name: "a", subjectKind: "user", subjectId: "x" })).toMatchObject({
      ok: false,
      code: "bad_input",
    });
    expect(await grantAgentSkillAction({ name: "a", subjectKind: "agent", subjectId: " " })).toMatchObject({
      ok: false,
      code: "bad_input",
    });
    expect(m.grant).not.toHaveBeenCalled();
  });
});
