// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for `src/lib/auth/active-tenant.ts`.
 *
 * ADR-0093 decision 4: the tenant comes from the session (resolved
 * server-side at sign-in), never a cookie. Covers `requireActiveTenant`
 * reading `session.tenantId` and re-validating it against
 * `getMyMemberships()`, `NoActiveTenantError` when the session has no
 * tenant, `StaleActiveTenantError` when the session's tenant is no longer
 * a current membership, and the three error-mapping helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Session module is mocked so each test controls what auth() returns.
const session = vi.hoisted(() => ({ tenantId: null as string | null }));
vi.mock("@/auth", () => ({
  auth: async () => (session.tenantId === undefined ? null : { tenantId: session.tenantId }),
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
  NoActiveTenantError,
  StaleActiveTenantError,
  requireActiveTenant,
  activeTenantApiResponse,
  activeTenantActionResult,
  activeTenantPageRedirect,
} from "@/src/lib/auth/active-tenant";

beforeEach(() => {
  session.tenantId = null;
  memberships.list = [];
  redirectTarget.url = "";
});

afterEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// requireActiveTenant, canonical resolver
// ---------------------------------------------------------------------------

describe("requireActiveTenant", () => {
  it("returns the session's tenant when it matches a current membership", async () => {
    session.tenantId = "acme";
    memberships.list = [{ tenantId: "acme", tenantName: "Acme", role: "admin" }];
    const id = await requireActiveTenant();
    expect(id).toBe("acme");
  });

  it("throws NoActiveTenantError when the session has no tenant", async () => {
    session.tenantId = null;
    await expect(requireActiveTenant()).rejects.toBeInstanceOf(NoActiveTenantError);
  });

  it("throws StaleActiveTenantError when the session's tenant is no longer a membership", async () => {
    session.tenantId = "acme";
    memberships.list = [];
    const err = await requireActiveTenant().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleActiveTenantError);
    expect((err as StaleActiveTenantError).tenantId).toBe("acme");
  });

  it("throws StaleActiveTenantError when memberships hold a different tenant than the session", async () => {
    session.tenantId = "acme";
    memberships.list = [{ tenantId: "other", tenantName: "Other", role: "member" }];
    await expect(requireActiveTenant()).rejects.toBeInstanceOf(StaleActiveTenantError);
  });

  it("throws StaleActiveTenantError when memberships somehow hold more than one entry", async () => {
    session.tenantId = "acme";
    memberships.list = [
      { tenantId: "acme", tenantName: "Acme", role: "admin" },
      { tenantId: "other", tenantName: "Other", role: "member" },
    ];
    await expect(requireActiveTenant()).rejects.toBeInstanceOf(StaleActiveTenantError);
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
  it("redirects to /onboarding for NoActiveTenantError", () => {
    expect(() => activeTenantPageRedirect(new NoActiveTenantError())).toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget.url).toBe("/onboarding");
  });

  it("redirects to /api/auth/federated-signout for StaleActiveTenantError", () => {
    expect(() => activeTenantPageRedirect(new StaleActiveTenantError("t1"))).toThrow(/NEXT_REDIRECT/);
    expect(redirectTarget.url).toBe("/api/auth/federated-signout");
  });

  it("re-throws any other error", () => {
    const err = new Error("unexpected");
    expect(() => activeTenantPageRedirect(err)).toThrow("unexpected");
  });
});
