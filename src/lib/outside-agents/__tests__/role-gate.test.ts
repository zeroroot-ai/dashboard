// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The role gate of the outside agent surface: each OutsideAgentService RPC needs
 * the tenant "admin" relation. The tests read the real generated registry and
 * run the real assertAuthorized for each tenant role.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/src/lib/auth/membership", () => ({ getMyMemberships: vi.fn() }));

import { auth } from "@/auth";
import { getMyMemberships } from "@/src/lib/auth/membership";
import { AuthRegistry, IdentityClass } from "@/src/gen/authz/registry";
import { AuthzDeniedError, assertAuthorized } from "@/src/lib/auth/assert-authorized";
import { OUTSIDE_AGENT_PAGE_METHOD } from "../gate";

const SERVICE = "/gibson.tenant.v1.OutsideAgentService/";
const RPCS = [
  "RegisterOutsideAgent",
  "ListOutsideAgents",
  "GetOutsideAgent",
  "DeleteOutsideAgent",
  "GrantOutsideAgent",
  "RevokeOutsideAgent",
  "ListOutsideAgentGrants",
];

describe("the registry entries of OutsideAgentService", () => {
  it.each(RPCS)("%s needs the admin relation on the tenant, for a USER", (rpc) => {
    const entry = AuthRegistry[SERVICE + rpc];
    expect(entry).toBeDefined();
    expect(entry.relation).toBe("admin");
    expect(entry.objectType).toBe("tenant");
    expect(entry.unauthenticated).toBe(false);
    expect(entry.allowedIdentities & IdentityClass.USER).toBeTruthy();
  });

  it("holds no other RPC than the seven that the pages use", () => {
    const found = Object.keys(AuthRegistry)
      .filter((k) => k.startsWith(SERVICE))
      .map((k) => k.slice(SERVICE.length))
      .sort();
    expect(found).toEqual([...RPCS].sort());
  });

  it("gates the pages on an RPC that exists", () => {
    expect(AuthRegistry[OUTSIDE_AGENT_PAGE_METHOD]).toBeDefined();
  });
});

describe("assertAuthorized for the outside agent pages", () => {
  beforeEach(() => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1" },
      tenantId: "tenant-a",
      expires: "",
    } as unknown as Awaited<ReturnType<typeof auth>>);
  });

  const asRole = (role: "owner" | "admin" | "writer" | "member") =>
    vi.mocked(getMyMemberships).mockResolvedValue([{ tenantId: "tenant-a", tenantName: "tenant-a", role }]);

  it.each(["owner", "admin"] as const)("lets the %s role in", async (role) => {
    asRole(role);
    await expect(assertAuthorized(OUTSIDE_AGENT_PAGE_METHOD)).resolves.toBeUndefined();
  });

  it.each(["writer", "member"] as const)("refuses the %s role", async (role) => {
    asRole(role);
    const err = await assertAuthorized(OUTSIDE_AGENT_PAGE_METHOD).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzDeniedError);
    expect((err as AuthzDeniedError).reason).toBe("relation-not-met");
  });
});
