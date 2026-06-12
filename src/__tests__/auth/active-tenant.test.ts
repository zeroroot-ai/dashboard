/**
 * Unit tests for `src/lib/auth/active-tenant.ts`.
 *
 * Covers HMAC sign/verify round-trip, tampered-cookie rejection, the
 * absent/invalid/present discriminator, NoActiveTenantError on missing
 * cookie, StaleActiveTenantError on a valid cookie that names a tenant
 * the user is no longer a member of, requireActiveTenant canonical alias,
 * and the three error-mapping helpers.
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

// next/navigation redirect is a throw, we capture it so RSC tests work.
const redirectTarget = { url: "" };
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirectTarget.url = url;
    // Simulate the Next.js NEXT_REDIRECT exception pattern.
    const err = new Error(`NEXT_REDIRECT:${url}`);
    (err as Error & { digest?: string }).digest = `NEXT_REDIRECT;push;${url};303;`;
    throw err;
  },
}));

// next/server NextResponse, provide a minimal stub so the module loads.
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      _body: body,
      _status: init?.status ?? 200,
      _headers: init?.headers ?? {},
    }),
  },
}));

import {
  ACTIVE_TENANT_COOKIE_NAME,
  NoActiveTenantError,
  StaleActiveTenantError,
  clearActiveTenant,
  getActiveTenant,
  readRawActiveTenant,
  requireActiveTenant,
  setActiveTenant,
  activeTenantApiResponse,
  activeTenantActionResult,
  activeTenantPageRedirect,
} from "@/src/lib/auth/active-tenant";

beforeEach(() => {
  cookieJar.clear();
  memberships.list = [];
  redirectTarget.url = "";
});

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Existing: setActiveTenant + getActiveTenant round-trip
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Existing: getActiveTenant error modes
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// requireActiveTenant, canonical alias
// ---------------------------------------------------------------------------

describe("requireActiveTenant", () => {
  it("is an alias for getActiveTenant, returns tenant when cookie present + valid member", async () => {
    memberships.list = [{ tenantId: "acme", tenantName: "Acme", role: "admin" }];
    await setActiveTenant("acme");
    const id = await requireActiveTenant();
    expect(id).toBe("acme");
  });

  it("throws NoActiveTenantError when no cookie is set", async () => {
    await expect(requireActiveTenant()).rejects.toBeInstanceOf(NoActiveTenantError);
  });

  it("throws NoActiveTenantError on a tampered HMAC", async () => {
    cookieJar.set(ACTIVE_TENANT_COOKIE_NAME, { value: "acme.0000000000000000" });
    await expect(requireActiveTenant()).rejects.toBeInstanceOf(NoActiveTenantError);
  });

  it("throws StaleActiveTenantError when tenant is no longer in memberships", async () => {
    memberships.list = [{ tenantId: "acme", tenantName: "Acme", role: "member" }];
    await setActiveTenant("acme");
    memberships.list = [];
    const err = await requireActiveTenant().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleActiveTenantError);
    expect((err as StaleActiveTenantError).tenantId).toBe("acme");
  });
});

// ---------------------------------------------------------------------------
// Error-mapping: activeTenantApiResponse
// ---------------------------------------------------------------------------

describe("activeTenantApiResponse", () => {
  it("returns a 412 response with code no_active_tenant for NoActiveTenantError", () => {
    const err = new NoActiveTenantError();
    const res = activeTenantApiResponse(err) as unknown as { _body: { code: string }; _status: number };
    expect(res._status).toBe(412);
    expect(res._body.code).toBe("no_active_tenant");
  });

  it("returns a 412 response with code stale_active_tenant for StaleActiveTenantError", () => {
    const err = new StaleActiveTenantError("t1");
    const res = activeTenantApiResponse(err) as unknown as { _body: { code: string }; _status: number };
    expect(res._status).toBe(412);
    expect(res._body.code).toBe("stale_active_tenant");
  });

  it("re-throws non-tenant errors", () => {
    const err = new Error("unexpected");
    expect(() => activeTenantApiResponse(err)).toThrow("unexpected");
  });

  it("forwards extra headers into the response", () => {
    const err = new NoActiveTenantError();
    const res = activeTenantApiResponse(err, { headers: { "x-correlation-id": "req-abc" } }) as unknown as {
      _headers: Record<string, string>;
    };
    expect(res._headers["x-correlation-id"]).toBe("req-abc");
  });
});

// ---------------------------------------------------------------------------
// Error-mapping: activeTenantActionResult
// ---------------------------------------------------------------------------

describe("activeTenantActionResult", () => {
  it("returns { ok: false, code: 'no_active_tenant' } for NoActiveTenantError", () => {
    const result = activeTenantActionResult(new NoActiveTenantError());
    expect(result).toEqual({ ok: false, code: "no_active_tenant" });
  });

  it("returns { ok: false, code: 'stale_active_tenant' } for StaleActiveTenantError", () => {
    const result = activeTenantActionResult(new StaleActiveTenantError("t1"));
    expect(result).toEqual({ ok: false, code: "stale_active_tenant" });
  });

  it("re-throws non-tenant errors", () => {
    const err = new TypeError("unexpected");
    expect(() => activeTenantActionResult(err)).toThrow("unexpected");
  });
});

// ---------------------------------------------------------------------------
// Error-mapping: activeTenantPageRedirect
// ---------------------------------------------------------------------------

describe("activeTenantPageRedirect", () => {
  it("calls redirect('/select-tenant') and throws a NEXT_REDIRECT error", () => {
    expect(() => activeTenantPageRedirect()).toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget.url).toBe("/select-tenant");
  });
});

// ---------------------------------------------------------------------------
// Existing: readRawActiveTenant
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Existing: clearActiveTenant
// ---------------------------------------------------------------------------

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
