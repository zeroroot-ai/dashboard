// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";
import { ADDRESS_REFUSED_MESSAGE } from "../address-refusal";
import { shownDaemonFailure } from "../shown-daemon-failure";

describe("shownDaemonFailure", () => {
  it("shows the daemon message of a validation error as text", () => {
    const err = new ConnectError("reference must name a digest, not a tag", Code.InvalidArgument);
    expect(shownDaemonFailure(err, "t")).toEqual({
      ok: false,
      error: "reference must name a digest, not a tag",
      code: "invalid_argument",
    });
  });

  it.each([
    [Code.FailedPrecondition, "failed_precondition"],
    [Code.NotFound, "not_found"],
    [Code.AlreadyExists, "already_exists"],
  ])("shows the message of code %s", (code, name) => {
    const r = shownDaemonFailure(new ConnectError("the reason", code), "t");
    expect(r).toEqual({ ok: false, error: "the reason", code: name });
  });

  it("shows a fixed text for a refused host, with no resolved address", () => {
    const err = new ConnectError(
      "RegisterOutsideAgent: the URL host is refused: agent.example.com resolves to 10.0.4.7 (private range), lookup via 10.96.0.10:53",
      Code.InvalidArgument,
    );
    const r = shownDaemonFailure(err, "t");
    expect(r).toEqual({ ok: false, error: ADDRESS_REFUSED_MESSAGE, code: "invalid_argument" });
    expect(r.error).not.toMatch(/10\.|resolves to|lookup/);
  });

  it("keeps the text of another URL problem", () => {
    const err = new ConnectError("RegisterOutsideAgent: the URL must use https", Code.InvalidArgument);
    expect(shownDaemonFailure(err, "t").error).toBe("RegisterOutsideAgent: the URL must use https");
  });

  it("maps a denial to Permission denied", () => {
    const err = new ConnectError("x", Code.PermissionDenied, undefined, undefined, new AuthzDeniedError("/m", "relation-not-met"));
    expect(shownDaemonFailure(err, "t")).toEqual({
      ok: false,
      error: "Permission denied",
      code: "permission_denied",
    });
  });

  it("hides the daemon text of an internal failure", () => {
    const r = shownDaemonFailure(new ConnectError("pq: relation agent_skills missing", Code.Internal), "t");
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("pq:");
    expect(r.code).toBe("internal");
  });

  it("hides the text of the provisioning failure", () => {
    const r = shownDaemonFailure(
      new ConnectError("tenant data plane not provisioned", Code.FailedPrecondition),
      "t",
    );
    expect(r.error).not.toContain("data plane");
    expect(r.code).toBe("provisioning");
  });

  it("hides the text of an error that is not a ConnectError", () => {
    const r = shownDaemonFailure(new Error("secret detail"), "t");
    expect(r.error).not.toContain("secret detail");
  });
});
