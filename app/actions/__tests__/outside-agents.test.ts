// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

const m = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  register: vi.fn(),
  del: vi.fn(),
  grant: vi.fn(),
  revoke: vi.fn(),
  grants: vi.fn(),
  session: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/auth", () => ({ getServerSession: m.session }));
vi.mock("@/src/lib/gibson-client/outside-agents", () => ({
  daemonListOutsideAgents: m.list,
  daemonGetOutsideAgent: m.get,
  daemonRegisterOutsideAgent: m.register,
  daemonDeleteOutsideAgent: m.del,
  daemonGrantOutsideAgent: m.grant,
  daemonRevokeOutsideAgent: m.revoke,
  daemonListOutsideAgentGrants: m.grants,
}));

import {
  deleteOutsideAgentAction,
  grantOutsideAgentAction,
  listOutsideAgentGrantsAction,
  listOutsideAgentsAction,
  registerOutsideAgentAction,
  revokeOutsideAgentAction,
} from "../outside-agents";

const VALID = {
  name: "scout",
  a2aUrl: "https://agent.example.com/a2a",
  credentialSecret: "cred",
  caBundleSecret: "",
  description: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1" } });
});

describe("outside agent actions", () => {
  it("need a session and call nothing without one", async () => {
    m.session.mockResolvedValue(null);
    expect(await listOutsideAgentsAction()).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(await registerOutsideAgentAction(VALID)).toMatchObject({ ok: false, code: "unauthenticated" });
    expect(m.list).not.toHaveBeenCalled();
    expect(m.register).not.toHaveBeenCalled();
  });

  it("register trims and sends the fields", async () => {
    m.register.mockResolvedValue({ name: "scout" });
    const r = await registerOutsideAgentAction({ ...VALID, name: " scout ", a2aUrl: " https://agent.example.com/a2a " });
    expect(r).toEqual({ ok: true, data: { name: "scout" } });
    expect(m.register).toHaveBeenCalledWith(VALID);
  });

  it.each([
    [{ name: "Bad_Name" }, /lowercase/i],
    [{ name: "" }, /required/i],
    [{ a2aUrl: "http://agent.example.com" }, /HTTPS/],
    [{ a2aUrl: "" }, /required/],
    [{ credentialSecret: "x".repeat(256) }, /255/],
    [{ description: "x".repeat(1025) }, /1024/],
  ])("register refuses %j before the call", async (over, re) => {
    const r = await registerOutsideAgentAction({ ...VALID, ...over });
    expect(r).toMatchObject({ ok: false, code: "bad_input" });
    if (!r.ok) expect(r.error).toMatch(re);
    expect(m.register).not.toHaveBeenCalled();
  });

  it("register shows the error of the daemon as text, and hides an internal error", async () => {
    m.register.mockRejectedValueOnce(new ConnectError("the host resolves to a private address", Code.InvalidArgument));
    expect(await registerOutsideAgentAction(VALID)).toEqual({
      ok: false,
      error: "the host resolves to a private address",
      code: "invalid_argument",
    });
    m.register.mockRejectedValueOnce(new ConnectError("dial tcp 10.1.1.1:5432 refused", Code.Internal));
    const r = await registerOutsideAgentAction(VALID);
    if (!r.ok) expect(r.error).not.toContain("10.1.1.1");
  });

  it("register maps ALREADY_EXISTS to its text", async () => {
    m.register.mockRejectedValue(new ConnectError("an outside agent with this name has other fields: delete it first", Code.AlreadyExists));
    expect(await registerOutsideAgentAction(VALID)).toMatchObject({ ok: false, code: "already_exists" });
  });

  it("grant and revoke send the name and the mission id", async () => {
    m.grant.mockResolvedValue(undefined);
    m.revoke.mockResolvedValue(undefined);
    expect(await grantOutsideAgentAction({ name: "scout", missionId: " m1 " })).toEqual({ ok: true, data: null });
    expect(await revokeOutsideAgentAction({ name: "scout", missionId: "m1" })).toEqual({ ok: true, data: null });
    expect(m.grant).toHaveBeenCalledWith("scout", "m1");
    expect(m.revoke).toHaveBeenCalledWith("scout", "m1");
  });

  it("grant refuses an empty mission id and a bad name", async () => {
    expect(await grantOutsideAgentAction({ name: "scout", missionId: " " })).toMatchObject({ ok: false, code: "bad_input" });
    expect(await grantOutsideAgentAction({ name: "Bad", missionId: "m" })).toMatchObject({ ok: false, code: "bad_input" });
    expect(m.grant).not.toHaveBeenCalled();
  });

  it("list grants and delete work by name", async () => {
    m.grants.mockResolvedValue({ items: ["m1"], truncated: true });
    m.del.mockResolvedValue(undefined);
    expect(await listOutsideAgentGrantsAction("scout")).toEqual({
      ok: true,
      data: { items: ["m1"], truncated: true },
    });
    expect(await deleteOutsideAgentAction("scout")).toEqual({ ok: true, data: null });
    expect(await deleteOutsideAgentAction("")).toMatchObject({ ok: false, code: "bad_input" });
  });
});
