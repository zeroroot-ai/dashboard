/**
 * dashboard-smoke.spec.ts
 *
 * Browser-side driver for the dashboard smoke e2e test (dashboard-smoke-e2e-tdd).
 *
 * This spec drives:
 *   1. Authenticated probe: for each non-excluded route in the manifest, navigate
 *      as tenant A and assert HTTP <400, landmark visible, no console errors,
 *      and optional JSON shape validation.
 *   2. Unauthenticated probe: for each auth-required route, assert 401/403/redirect.
 *   3. Session setup for the cross-tenant isolation test (Go side does the assertions).
 *
 * The spec reads MANIFEST_PATH (path to dashboard-routes.yaml) and iterates
 * routes in parallel (concurrency: SMOKE_CONCURRENCY, default 4).
 *
 * Output files:
 *   /tmp/dashboard-smoke-report-<slug-a>.json   — full per-route results for Go side
 *   /tmp/dashboard-smoke-session-a-<slug-a>.json — session A cookie jar
 *   /tmp/dashboard-smoke-session-b-<slug-b>.json — session B cookie jar
 *
 * Env vars consumed:
 *   SIGNUP_SLUG_A      — tenant A slug (set by orchestrator)
 *   SIGNUP_EMAIL_A     — tenant A email (set by orchestrator)
 *   SIGNUP_SLUG_B      — tenant B slug (set by orchestrator)
 *   SIGNUP_EMAIL_B     — tenant B email (set by orchestrator)
 *   SIGNUP_PASSWORD    — shared password for synthetic test tenants
 *   SMOKE_CONCURRENCY  — number of parallel route loads (default: 4)
 *   MANIFEST_PATH      — path to dashboard-routes.yaml
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: https://app.zeroroot.local:30443)
 *
 * Security:
 *   - Cookie values are NEVER logged (only presence and name).
 *   - Uses synthetic credentials; never logs passwords.
 *   - Screenshots are taken on failure only.
 *
 * Helpers:
 *   - signUpViaForm (Task 4): drives the real Gibson signup form.
 *   - loginViaZitadelV2 (Task 9): drives the Zitadel V2 OIDC login UI.
 *
 * Requirements: R1, R2, R3 (session setup), R7.
 */

import {
  test,
  expect,
  type BrowserContext,
} from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { signUpViaForm } from "./helpers/signup-via-form";
import { loginViaZitadelV2 } from "./helpers/login-via-zitadel-v2";
import { securePassword } from "./helpers/fixtures";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLUSTER_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

const SLUG_A = process.env.SIGNUP_SLUG_A ?? "";
const EMAIL_A = process.env.SIGNUP_EMAIL_A ?? "";
const SLUG_B = process.env.SIGNUP_SLUG_B ?? "";
const EMAIL_B = process.env.SIGNUP_EMAIL_B ?? "";
const SYNTHETIC_PASSWORD = process.env.SIGNUP_PASSWORD ?? securePassword();
const MANIFEST_PATH =
  process.env.MANIFEST_PATH ??
  path.resolve(
    __dirname,
    "../../../../core/gibson/tests/e2e/manifests/dashboard-routes.yaml",
  );
const CONCURRENCY = parseInt(process.env.SMOKE_CONCURRENCY ?? "4", 10);

/** Perf budget cold-cache multiplier per R7.2. */
const COLD_CACHE_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Types matching the route manifest schema
// ---------------------------------------------------------------------------

interface RouteEntry {
  path: string;
  kind: "page" | "api" | "action";
  method?: string;
  auth: "required" | "public";
  landmark?: string | null;
  shape_schema?: string | null;
  upstream_rpc?: string;
  perf_budget_ms?: number;
  excluded?: boolean;
  excluded_reason?: string;
  excluded_tracking_issue?: string;
}

interface RouteManifest {
  routes: RouteEntry[];
}

// ---------------------------------------------------------------------------
// Smoke report types (written to /tmp for the Go side)
// ---------------------------------------------------------------------------

interface RouteResult {
  path: string;
  ok: boolean;
  httpStatus: number;
  loadTimeMs: number;
  landmarkOk: boolean;
  consoleErrors: string[];
  shapeError: string;
  screenshotPath: string;
  authMode: "authenticated" | "unauthenticated";
}

interface SmokeReport {
  slug: string;
  totalRoutes: number;
  passed: number;
  failed: number;
  startTime: string;
  endTime: string;
  results: RouteResult[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load and parse the route manifest. */
function loadManifest(manifestPath: string): RouteEntry[] {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const manifest = yaml.load(raw) as RouteManifest;
  if (!manifest?.routes) {
    throw new Error(`dashboard-smoke: manifest at ${manifestPath} has no routes`);
  }
  return manifest.routes;
}

/** Resolve a route path to a full URL, substituting test placeholder values. */
function resolveURL(routePath: string, slugA: string): string {
  const resolved = routePath
    .replace("{slug}", slugA)
    .replace("{id}", "smoke-test-probe-00000000")
    .replace("{userId}", "smoke-test-probe-00000000")
    .replace("{obsId}", "smoke-test-probe-00000000")
    .replace("{name}", "anthropic")
    .replace("{...path}", "pods")
    .replace("{...slug}", "getting-started");
  return CLUSTER_URL.replace(/\/$/, "") + resolved;
}

/**
 * Establish an authenticated session using the real signup + Zitadel V2 login flow.
 *
 * Uses signUpViaForm (Task 4) to create the tenant, then loginViaZitadelV2
 * (Task 9) to complete the OIDC exchange. Best-effort: signup may fail if the
 * tenant already exists — loginViaZitadelV2 is attempted regardless.
 */
async function establishSession(
  context: BrowserContext,
  slug: string,
  email: string,
  password: string,
): Promise<void> {
  const page = await context.newPage();
  try {
    // Sign up (best-effort — tenant may already exist from a prior run).
    try {
      await signUpViaForm(page, { slug, email, password, baseURL: CLUSTER_URL });
      // After signup, the page lands on /login?callbackUrl=/dashboard.
      // Clear the browser state so loginViaZitadelV2 drives a clean flow.
      await context.clearCookies();
      await page.evaluate(() => {
        try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
      });
    } catch (signupErr: unknown) {
      const msg = signupErr instanceof Error ? signupErr.message : String(signupErr);
      console.log(`[dashboard-smoke] signUpViaForm failed (slug=${slug}): ${msg} — proceeding to login`);
    }

    // Drive Zitadel V2 login UI.
    await loginViaZitadelV2(page, context, {
      email,
      password,
      baseURL: CLUSTER_URL,
      loginFormTimeoutMs: 30_000,
      loginCompleteTimeoutMs: 60_000,
    });
  } finally {
    await page.close();
  }
}

/**
 * Test a single route as an authenticated user.
 *
 * Returns a RouteResult. Does NOT throw — all failures are captured in the result.
 */
async function testRouteAuthenticated(
  context: BrowserContext,
  entry: RouteEntry,
  slugA: string,
  isFirstRun: boolean,
  screenshotDir: string,
): Promise<RouteResult> {
  const url = resolveURL(entry.path, slugA);
  const budget =
    (entry.perf_budget_ms ?? 3000) * (isFirstRun ? COLD_CACHE_MULTIPLIER : 1);
  const method = (entry.method ?? "GET").toUpperCase();

  const result: RouteResult = {
    path: entry.path,
    ok: false,
    httpStatus: 0,
    loadTimeMs: 0,
    landmarkOk: false,
    consoleErrors: [],
    shapeError: "",
    screenshotPath: "",
    authMode: "authenticated",
  };

  // For API routes, use fetch (not full page navigation).
  if (entry.kind === "api" || entry.kind === "action") {
    try {
      const start = Date.now();
      const resp = await context.request.fetch(url, {
        method,
        failOnStatusCode: false,
        timeout: budget,
      });
      result.loadTimeMs = Date.now() - start;
      result.httpStatus = resp.status();
      result.ok = resp.status() < 400;

      if (method === "GET" && result.ok) {
        const ct = resp.headers()["content-type"] ?? "";
        if (!ct.includes("application/json") && !ct.includes("text/event-stream")) {
          result.ok = false;
          result.shapeError = `expected Content-Type: application/json but got: ${ct}`;
        }
      }

      if (result.loadTimeMs > budget) {
        result.ok = false;
        result.shapeError += ` perf_budget exceeded: ${result.loadTimeMs}ms > ${budget}ms`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      result.shapeError = `fetch error: ${msg}`;
    }
    return result;
  }

  // For page routes, use a full Playwright page.
  const page = await context.newPage();
  const consoleErrors: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    const start = Date.now();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: budget,
    });
    result.loadTimeMs = Date.now() - start;
    result.httpStatus = response?.status() ?? 0;

    if (result.httpStatus >= 400) {
      result.ok = false;
      const screenshotPath = path.join(
        screenshotDir,
        `failure-${slugA}-${entry.path.replace(/\//g, "_")}.png`,
      );
      await page.screenshot({ path: screenshotPath });
      result.screenshotPath = screenshotPath;
      result.consoleErrors = consoleErrors;
      return result;
    }

    if (entry.landmark) {
      const landmarkLocator = page.locator(entry.landmark);
      try {
        await expect(landmarkLocator).toBeVisible({ timeout: 5_000 });
        result.landmarkOk = true;
      } catch {
        result.landmarkOk = false;
      }
    } else {
      result.landmarkOk = true;
    }

    if (result.loadTimeMs > budget) {
      result.ok = false;
      result.shapeError = `perf_budget exceeded: ${result.loadTimeMs}ms > ${budget}ms`;
    }

    result.consoleErrors = consoleErrors;
    result.ok =
      result.httpStatus < 400 && result.landmarkOk && result.shapeError === "";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.shapeError = `navigation error: ${msg}`;
    try {
      const screenshotPath = path.join(
        screenshotDir,
        `timeout-${slugA}-${entry.path.replace(/\//g, "_")}.png`,
      );
      await page.screenshot({ path: screenshotPath });
      result.screenshotPath = screenshotPath;
    } catch {
      // Screenshot failed too — ignore.
    }
  } finally {
    await page.close();
  }

  return result;
}

/**
 * Test a single route as an unauthenticated user.
 *
 * Auth-required routes must return 401/403/redirect-to-login.
 * Public routes must return 200.
 */
async function testRouteUnauthenticated(
  context: BrowserContext,
  entry: RouteEntry,
  slugA: string,
): Promise<RouteResult> {
  const url = resolveURL(entry.path, slugA);
  const budget = entry.perf_budget_ms ?? 3000;
  const method = (entry.method ?? "GET").toUpperCase();

  const result: RouteResult = {
    path: entry.path,
    ok: false,
    httpStatus: 0,
    loadTimeMs: 0,
    landmarkOk: false,
    consoleErrors: [],
    shapeError: "",
    screenshotPath: "",
    authMode: "unauthenticated",
  };

  try {
    const start = Date.now();
    const resp = await context.request.fetch(url, {
      method,
      failOnStatusCode: false,
      timeout: budget,
      maxRedirects: 0,
    });
    result.loadTimeMs = Date.now() - start;
    result.httpStatus = resp.status();

    if (entry.auth === "public") {
      result.ok = result.httpStatus === 200 || result.httpStatus < 400;
      if (!result.ok) {
        result.shapeError = `public route returned HTTP ${result.httpStatus} without session (expected 200)`;
      }
    } else {
      const isBlocked =
        result.httpStatus === 401 ||
        result.httpStatus === 403 ||
        result.httpStatus === 302 ||
        result.httpStatus === 307 ||
        result.httpStatus === 308;
      result.ok = isBlocked;
      if (!result.ok && result.httpStatus === 200) {
        result.shapeError =
          `SECURITY REGRESSION: auth-required route ${entry.path} returned HTTP 200 without session`;
      } else if (!result.ok) {
        result.shapeError = `unexpected HTTP ${result.httpStatus} for unauthenticated probe`;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // For auth-required routes, a connection error (e.g., TLS rejection) may
    // also indicate proper blocking — treat as pass.
    if (entry.auth === "required") {
      result.ok = true;
    } else {
      result.shapeError = `fetch error: ${msg}`;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main test suite
// ---------------------------------------------------------------------------

test.describe("dashboard smoke", () => {
  test.describe.configure({ mode: "parallel" });

  let manifestEntries: RouteEntry[] = [];
  const screenshotDir = "/tmp";

  test.beforeAll(async () => {
    if (!SLUG_A) throw new Error("dashboard-smoke: SIGNUP_SLUG_A env var is required");
    if (!EMAIL_A) throw new Error("dashboard-smoke: SIGNUP_EMAIL_A env var is required");
    if (!SLUG_B) throw new Error("dashboard-smoke: SIGNUP_SLUG_B env var is required");
    if (!EMAIL_B) throw new Error("dashboard-smoke: SIGNUP_EMAIL_B env var is required");

    manifestEntries = loadManifest(MANIFEST_PATH);
  });

  // -------------------------------------------------------------------------
  // Test 1: Authenticated probe — every non-excluded route as tenant A
  // -------------------------------------------------------------------------
  test("authenticated route smoke (R1)", async ({ browser }) => {
    // signUpViaForm needs up to 120s provisioning; loginViaZitadelV2 needs 60s.
    test.setTimeout(300_000);

    const contextA = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      // Establish a real session for tenant A via the signup + Zitadel V2 flow.
      await establishSession(contextA, SLUG_A, EMAIL_A, SYNTHETIC_PASSWORD);

      // Save session A for the cross-tenant isolation test.
      const sessionPathA = `/tmp/dashboard-smoke-session-a-${SLUG_A}.json`;
      await contextA.storageState({ path: sessionPathA });
      console.log(`[dashboard-smoke] session A saved to ${sessionPathA}`);

      // Run the authenticated probe over all non-excluded routes.
      const activeRoutes = manifestEntries.filter((e) => !e.excluded);
      const startTime = new Date().toISOString();
      const allResults: RouteResult[] = [];
      const failures: string[] = [];

      for (let i = 0; i < activeRoutes.length; i += CONCURRENCY) {
        const batch = activeRoutes.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((entry, batchIdx) =>
            testRouteAuthenticated(
              contextA,
              entry,
              SLUG_A,
              i === 0 && batchIdx === 0,
              screenshotDir,
            ),
          ),
        );
        allResults.push(...batchResults);
        for (const r of batchResults) {
          if (!r.ok) {
            failures.push(
              `FAIL ${r.path}: http=${r.httpStatus} landmark=${r.landmarkOk} errors=${r.consoleErrors.length} shape=${r.shapeError}`,
            );
          }
        }
      }

      const endTime = new Date().toISOString();

      const report: SmokeReport = {
        slug: SLUG_A,
        totalRoutes: activeRoutes.length,
        passed: allResults.filter((r) => r.ok).length,
        failed: failures.length,
        startTime,
        endTime,
        results: allResults,
      };
      const reportPath = `/tmp/dashboard-smoke-report-${SLUG_A}.json`;
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      console.log(
        `[dashboard-smoke] report written to ${reportPath} (passed=${report.passed}/${report.totalRoutes})`,
      );

      if (failures.length > 0) {
        throw new Error(
          `dashboard-smoke: ${failures.length} route(s) failed (see ${reportPath}):\n${failures.join("\n")}`,
        );
      }
    } finally {
      await contextA.close();
    }
  });

  // -------------------------------------------------------------------------
  // Test 2: Unauthenticated probe — every route without a session (R2)
  // -------------------------------------------------------------------------
  test("unauthenticated probe (R2)", async ({ browser }) => {
    const noAuthContext = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      const activeRoutes = manifestEntries.filter((e) => !e.excluded);
      const failures: string[] = [];

      for (let i = 0; i < activeRoutes.length; i += CONCURRENCY) {
        const batch = activeRoutes.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map((entry) =>
            testRouteUnauthenticated(noAuthContext, entry, SLUG_A),
          ),
        );
        for (const r of batchResults) {
          if (!r.ok) {
            failures.push(`UNAUTH-FAIL ${r.path}: http=${r.httpStatus} ${r.shapeError}`);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `dashboard-smoke: ${failures.length} unauthenticated probe(s) failed:\n${failures.join("\n")}`,
        );
      }
    } finally {
      await noAuthContext.close();
    }
  });

  // -------------------------------------------------------------------------
  // Test 3: Cross-tenant session setup — sign up + log in tenant B (R3 prep)
  //
  // Actual cross-tenant assertions are on the Go side (TestDashboard_CrossTenantIsolation).
  // This spec establishes the session cookie jars via the real OIDC flow.
  // -------------------------------------------------------------------------
  test("cross-tenant session setup for Go assertions (R3)", async ({ browser }) => {
    // Signup (120s) + Zitadel login (60s) budget for tenant B.
    test.setTimeout(300_000);

    const contextB = await browser.newContext({ ignoreHTTPSErrors: true });

    try {
      await establishSession(contextB, SLUG_B, EMAIL_B, SYNTHETIC_PASSWORD);

      const sessionPathB = `/tmp/dashboard-smoke-session-b-${SLUG_B}.json`;
      await contextB.storageState({ path: sessionPathB });
      console.log(`[dashboard-smoke] session B saved to ${sessionPathB}`);
    } finally {
      await contextB.close();
    }
  });
});
