/**
 * Tests for the Server Action daemon-error mapper (GHSA-xxg9-2h3v-588p).
 *
 * The contract under test is narrow and worth stating plainly: nothing the
 * daemon wrote may reach the returned object.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

vi.mock("server-only", () => ({}));

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }));

vi.mock("@/src/lib/logger", () => ({
  logger: { error: mockLogError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  serverActionError,
  type ServerActionErrorResult,
} from "@/src/lib/errors/server-action-error";
import { ERROR_CLASS_TABLE } from "@/src/lib/api-errors";

beforeEach(() => vi.clearAllMocks());

describe("serverActionError", () => {
  it("classifies a ConnectError and returns canonical copy, never the daemon text", () => {
    const err = new ConnectError(
      "vault mount kv2/ not found on https://vault.internal:8200",
      Code.NotFound,
    );

    const result: ServerActionErrorResult = serverActionError(err, {
      action: "getSecretAction",
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("not_found");
    expect(result.error).toBe(ERROR_CLASS_TABLE.not_found.message);
    expect(result.error).not.toContain("vault.internal");
    expect(result.error).not.toContain("kv2");
  });

  it.each([
    [Code.Unauthenticated, "unauthenticated"],
    [Code.PermissionDenied, "permission_denied"],
    [Code.NotFound, "not_found"],
    [Code.FailedPrecondition, "failed_precondition"],
    [Code.ResourceExhausted, "resource_exhausted"],
    [Code.Unavailable, "unavailable"],
    [Code.DeadlineExceeded, "deadline_exceeded"],
    [Code.InvalidArgument, "invalid_argument"],
    [Code.Internal, "internal"],
  ])("maps Code %s onto its canonical class", (code, expected) => {
    expect(serverActionError(new ConnectError("boom", code)).code).toBe(expected);
  });

  it("never forwards the daemon message for invalid_argument either", () => {
    const err = new ConnectError(
      "field tenant_shard_id: value 7 out of range for shard table",
      Code.InvalidArgument,
    );

    const result = serverActionError(err);

    expect(result.code).toBe("invalid_argument");
    expect(result.error).toBe(ERROR_CLASS_TABLE.invalid_argument.message);
    expect(result.error).not.toContain("tenant_shard_id");
  });

  it("recovers the class from the flattened wrapper shape (numeric code string)", () => {
    // What throwMapped in src/lib/gibson-client/secrets.ts actually throws:
    // a plain Error whose `code` is the Connect enum stringified.
    const wrapped = Object.assign(new Error("[unavailable] broker down"), {
      code: String(Code.Unavailable),
    });

    expect(serverActionError(wrapped).code).toBe("unavailable");
  });

  it("recovers the class from a textual code string", () => {
    const wrapped = Object.assign(new Error("nope"), { code: "permission_denied" });
    expect(serverActionError(wrapped).code).toBe("permission_denied");
  });

  it("falls back to internal for an unrecognised code", () => {
    const wrapped = Object.assign(new Error("nope"), { code: "banana" });
    const result = serverActionError(wrapped);
    expect(result.code).toBe("internal");
    expect(result.error).toBe(ERROR_CLASS_TABLE.internal.message);
  });

  it("sub-classifies the not-yet-provisioned precondition as provisioning", () => {
    const err = new ConnectError(
      "tenant data-plane not provisioned",
      Code.FailedPrecondition,
    );
    expect(serverActionError(err).code).toBe("provisioning");
  });

  it("handles a non-Error throw", () => {
    const result = serverActionError("just a string");
    expect(result.code).toBe("internal");
    expect(result.error).toBe(ERROR_CLASS_TABLE.internal.message);
  });

  it("mints a correlation ID and logs the detail against it", () => {
    const err = new ConnectError("internal hostname vault.svc leaked", Code.Internal);

    const result = serverActionError(err, { action: "setSecretAction" });

    expect(result.correlationId).toMatch(/^req-[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(mockLogError).toHaveBeenCalledTimes(1);
    const record = mockLogError.mock.calls[0][0];
    expect(record.correlationId).toBe(result.correlationId);
    expect(record.action).toBe("setSecretAction");
    // The detail is kept, but only server-side.
    expect(record.detail).toContain("vault.svc");
  });

  it("applies the caller's redactor to the logged detail", () => {
    const err = new ConnectError(
      "rejected value=hunter2 for mount kv2",
      Code.InvalidArgument,
    );

    serverActionError(err, {
      action: "setSecretAction",
      redact: (d) => d.replace(/value=\S+/g, "value=[REDACTED]"),
    });

    const record = mockLogError.mock.calls[0][0];
    expect(record.detail).not.toContain("hunter2");
    expect(record.detail).toContain("[REDACTED]");
  });

  it("returns a distinct correlation ID per call", () => {
    const a = serverActionError(new Error("x"));
    const b = serverActionError(new Error("x"));
    expect(a.correlationId).not.toBe(b.correlationId);
  });
});
