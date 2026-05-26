/**
 * crd-authz.spec.ts
 *
 * End-to-end tests for the CRD Server Action authorization gate.
 * Runs against a live Kind cluster (gibson context) with two seeded tenants.
 *
 * Journeys proven:
 *   1. Tenant-scoped user from tenant A gets FORBIDDEN when attempting a
 *      delete on tenant B. UI must NOT reveal whether tenant B exists —
 *      FORBIDDEN is the observable, not NOT_FOUND.
 *   2. platform-operator (cross-tenant role) can operate across tenants.
 *   3. Sixth fetchBootstrapToken attempt within 5 minutes returns
 *      RATE_LIMITED.
 *
 * Environment variables:
 *   PLAYWRIGHT_BASE_URL     — dashboard URL (default http://localhost:30081)
 *   E2E_TENANT_A_EMAIL      — tenant-A admin email
 *   E2E_TENANT_A_PASSWORD   — tenant-A admin password
 *   E2E_TENANT_A_NAME       — tenant A's CR name (e.g. "acme-a")
 *   E2E_TENANT_B_NAME       — tenant B's CR name (target of the deny test)
 *   E2E_PLATFORM_OPERATOR_EMAIL    — cross-tenant account email
 *   E2E_PLATFORM_OPERATOR_PASSWORD — cross-tenant account password
 *   E2E_ENROLLMENT_NAME     — an AgentEnrollment in tenant A with a ready
 *                             bootstrap secret, used for the rate-limit test
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:30081";
const TENANT_A_EMAIL = process.env.E2E_TENANT_A_EMAIL ?? "alice@tenant-a.example.com";
const TENANT_A_PASSWORD = process.env.E2E_TENANT_A_PASSWORD ?? "password";
const TENANT_A_NAME = process.env.E2E_TENANT_A_NAME ?? "tenant-a";
const TENANT_B_NAME = process.env.E2E_TENANT_B_NAME ?? "tenant-b";
const OPERATOR_EMAIL = process.env.E2E_PLATFORM_OPERATOR_EMAIL ?? "ops@zeroroot.ai";
const OPERATOR_PASSWORD = process.env.E2E_PLATFORM_OPERATOR_PASSWORD ?? "password";
const ENROLLMENT_NAME = process.env.E2E_ENROLLMENT_NAME ?? "e2e-agent";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(new RegExp(`${BASE_URL}/(dashboard|login/tenant-picker)`));
}

async function sessionCookie(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function callServerAction(
  request: APIRequestContext,
  cookie: string,
  actionPath: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  // React Server Action RPC is a POST to the enclosing page with headers that
  // encode the action reference. For robustness the dashboard exposes a thin
  // RPC bridge under /api/test/server-action used only in E2E — the bridge
  // authenticates via Auth.js session cookies and forwards to the named
  // action. If the bridge is not present, tests should be skipped with
  // test.skip() by the caller.
  const res = await request.post(`${BASE_URL}/api/test/server-action`, {
    headers: { cookie, "content-type": "application/json" },
    data: { action: actionPath, args: body },
  });
  return { status: res.status(), json: await res.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// Journey 1 — tenant-scoped user cannot operate on another tenant
// ---------------------------------------------------------------------------

test.describe("Journey 1 — cross-tenant deny", () => {
  test("tenant-A user deleting tenant B sees FORBIDDEN (not NOT_FOUND)", async ({ page, request }) => {
    await loginAs(page, TENANT_A_EMAIL, TENANT_A_PASSWORD);
    const cookie = await sessionCookie(page);

    // The delete confirmation page requires typing the tenant name to arm
    // the delete button. Navigate and simulate a cross-tenant attempt via
    // the Server Action bridge.
    const r = await callServerAction(request, cookie, "crd/deleteTenantAction", [
      TENANT_B_NAME,
      TENANT_B_NAME,
    ]);

    expect(r.status).toBe(200);
    const payload = r.json as { ok: boolean; code?: string };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("FORBIDDEN");
    // Invariant: UI MUST NOT disclose whether tenant B exists.
    expect(payload.code).not.toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Journey 2 — platform-operator can operate across tenants
// ---------------------------------------------------------------------------

test.describe("Journey 2 — cross-tenant success for operator", () => {
  test("platform-operator can update tenant A's tier", async ({ page, request }) => {
    await loginAs(page, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const cookie = await sessionCookie(page);

    const r = await callServerAction(request, cookie, "crd/updateTenantAction", [
      TENANT_A_NAME,
      { tier: "enterprise" },
    ]);
    expect(r.status).toBe(200);
    const payload = r.json as { ok: boolean };
    expect(payload.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Journey 3 — fetchBootstrapToken rate limit
// ---------------------------------------------------------------------------

test.describe("Journey 3 — bootstrap token rate-limit", () => {
  test("sixth fetch within 5 minutes returns RATE_LIMITED", async ({ page, request }) => {
    await loginAs(page, OPERATOR_EMAIL, OPERATOR_PASSWORD);
    const cookie = await sessionCookie(page);

    // Five allowed.
    for (let i = 0; i < 5; i++) {
      const ok = await callServerAction(request, cookie, "crd/fetchBootstrapTokenAction", [
        TENANT_A_NAME,
        ENROLLMENT_NAME,
      ]);
      expect(ok.status).toBe(200);
      // Either ok:true or a non-RATE_LIMITED denial (e.g. consumed secret);
      // both are acceptable here — we only assert budget is not exhausted.
      const p = ok.json as { ok: boolean; code?: string };
      if (!p.ok) expect(p.code).not.toBe("RATE_LIMITED");
    }

    const sixth = await callServerAction(request, cookie, "crd/fetchBootstrapTokenAction", [
      TENANT_A_NAME,
      ENROLLMENT_NAME,
    ]);
    expect(sixth.status).toBe(200);
    const p = sixth.json as { ok: boolean; code?: string };
    expect(p.ok).toBe(false);
    expect(p.code).toBe("RATE_LIMITED");
  });
});

// ---------------------------------------------------------------------------
// Build-time guard wiring — asserted here so this spec fails if the wiring
// ever regresses, even without running the guards themselves.
// ---------------------------------------------------------------------------

test.describe("prebuild wiring", () => {
  test("package.json prebuild runs both auth guards", () => {
    const pkgPath = resolve(join(__dirname, "..", "package.json"));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    const prebuild = pkg.scripts?.prebuild ?? "";
    expect(prebuild).toContain("check-no-public-auth.mjs");
    expect(prebuild).toContain("check-crd-action-authz.mjs");
  });
});
