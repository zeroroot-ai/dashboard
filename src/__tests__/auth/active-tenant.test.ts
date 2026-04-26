/**
 * Unit tests for `src/lib/auth/active-tenant.ts`.
 *
 * Covers HMAC sign/verify round-trip, tampered-cookie rejection, the
 * absent/invalid/present discriminator, NoActiveTenantError on missing
 * cookie, and StaleActiveTenantError on a valid cookie that names a
 * tenant the user is no longer a member of.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// AUTH_SECRET must be set BEFORE the module loads.
process.env.AUTH_SECRET = "test-secret-32-chars-long-enough!!";

// In-memory cookie jar mock for next/headers.
const cookieJar = new Map<string, { value: string }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.get(name),
    set: (name: string, value: string) => cookieJar.set(name, { value }),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

// Membership module is mocked so each test controls what getMyMemberships returns.
const memberships = vi.hoisted(() => ({ list: [] as { tenantId: string; tenantName: string; role: "admin" | "member" }[] }));
vi.mock("@/src/lib/auth/membership", () => ({
  getMyMemberships: async () => memberships.list,
  MembershipResolutionError: class extends Error {},
}));

// react.cache must not memoize across tests.
vi.mock("react", () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import {
  ACTIVE_TENANT_COOKIE_NAME,
  NoActiveTenantError,
  StaleActiveTenantError,
  clearActiveTenant,
  getActiveTenant,
  readRawActiveTenant,
  setActiveTenant,
} from "@/src/lib/auth/active-tenant";

beforeEach(() => {
  cookieJar.clear();
  memberships.list = [];
});

afterEach(() => vi.clearAllMocks());

describe("setActiveTenant + getActiveTenant round-trip", () => {
  it("writes a signed cookie when the user is a member", async () => {
    memberships.list = [
      { tenantId: "t1", tenantName: "Tenant 1", role: "member" },
    ];
    const result = await setActiveTenant("t1");
    expect(result.ok).toBe(true);
    expect(cookieJar.has(ACTIVE_TENANT_COOKIE_NAME)).toBe(true);
    const got = await getActiveTenant();
    expect(got).toBe("t1");
  });

  it("rejects when the user is not a member", async () => {
    memberships.list = [];
    const result = await setActiveTenant("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_a_member");
    expect(cookieJar.has(ACTIVE_TENANT_COOKIE_NAME)).toBe(false);
  });
});

describe("getActiveTenant error modes", () => {
  it("throws NoActiveTenantError when no cookie is set", async () => {
    await expect(getActiveTenant()).rejects.toBeInstanceOf(NoActiveTenantError);
  });

  it("throws NoActiveTenantError on a tampered cookie", async () => {
    cookieJar.set(ACTIVE_TENANT_COOKIE_NAME, { value: "t1.deadbeef" });
    await expect(getActiveTenant()).rejects.toBeInstanceOf(NoActiveTenantError);
  });

  it("throws StaleActiveTenantError when the cookie's tenant is no longer in memberships", async () => {
    memberships.list = [
      { tenantId: "t1", tenantName: "T1", role: "member" },
    ];
    await setActiveTenant("t1");
    // Revoke the membership.
    memberships.list = [];
    await expect(getActiveTenant()).rejects.toBeInstanceOf(StaleActiveTenantError);
  });
});

describe("readRawActiveTenant", () => {
  it("returns absent when no cookie is set", async () => {
    const r = await readRawActiveTenant();
    expect(r.status).toBe("absent");
  });

  it("returns invalid for a tampered cookie", async () => {
    cookieJar.set(ACTIVE_TENANT_COOKIE_NAME, { value: "t1.deadbeef" });
    const r = await readRawActiveTenant();
    expect(r.status).toBe("invalid");
  });

  it("returns present + the decoded tenantId for a valid cookie", async () => {
    memberships.list = [
      { tenantId: "t1", tenantName: "T1", role: "member" },
    ];
    await setActiveTenant("t1");
    const r = await readRawActiveTenant();
    expect(r.status).toBe("present");
    if (r.status === "present") expect(r.tenantId).toBe("t1");
  });
});

describe("clearActiveTenant", () => {
  it("removes the cookie", async () => {
    memberships.list = [
      { tenantId: "t1", tenantName: "T1", role: "admin" },
    ];
    await setActiveTenant("t1");
    expect(cookieJar.has(ACTIVE_TENANT_COOKIE_NAME)).toBe(true);
    await clearActiveTenant();
    expect(cookieJar.has(ACTIVE_TENANT_COOKIE_NAME)).toBe(false);
  });
});
