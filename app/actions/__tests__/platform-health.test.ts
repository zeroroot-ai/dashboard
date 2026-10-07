// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * getPlatformHealthAction (hosted#174): the mapping of the daemon answer,
 * the denial of a caller without platform_owner, and that no unset state
 * reads as healthy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";

const mockGet = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/src/lib/gibson-client", () => ({
  userClient: () => ({ adminGetPlatformHealth: mockGet }),
}));

import { getPlatformHealthAction } from "../platform-health";
import { PlatformPlaneState } from "@/src/gen/gibson/tenant/v1/admin_tenant_pb";

beforeEach(() => vi.clearAllMocks());

describe("getPlatformHealthAction", () => {
  it("maps a secret source that does not answer to unhealthy, with its cause", async () => {
    mockGet.mockResolvedValue({
      planes: [
        {
          plane: "secret_plane",
          state: PlatformPlaneState.UNHEALTHY,
          detail: "the secret source did not answer: dial tcp: i/o timeout",
          checkedAtUnix: BigInt(1700000000),
        },
      ],
    });
    const res = await getPlatformHealthAction();
    expect(res).toEqual({
      ok: true,
      data: [
        {
          plane: "secret_plane",
          state: "unhealthy",
          detail: "the secret source did not answer: dial tcp: i/o timeout",
          checkedAtUnix: 1700000000,
        },
      ],
    });
  });

  it("never reads an unset or unknown state as healthy", async () => {
    mockGet.mockResolvedValue({
      planes: [
        { plane: "a", state: PlatformPlaneState.UNSPECIFIED, detail: "", checkedAtUnix: BigInt(0) },
        { plane: "b", state: PlatformPlaneState.UNKNOWN, detail: "", checkedAtUnix: BigInt(0) },
      ],
    });
    const res = await getPlatformHealthAction();
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.map((p) => p.state)).toEqual(["unknown", "unknown"]);
  });

  it("answers denied for a caller without the platform_owner relation", async () => {
    mockGet.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));
    expect(await getPlatformHealthAction()).toEqual({ ok: false, code: "denied" });
  });

  it("answers failed when the daemon is unavailable", async () => {
    mockGet.mockRejectedValue(new ConnectError("down", Code.Unavailable));
    expect(await getPlatformHealthAction()).toEqual({ ok: false, code: "failed" });
  });
});
