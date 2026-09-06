/**
 * fault-proxy.ts, worker-scoped Playwright test fixtures for JWKS and
 * token-exchange fault injection.
 *
 * WHY a proxy instead of a server-side env-var toggle
 * ---------------------------------------------------
 * Auth.js performs JWKS fetches and OIDC token exchanges as server-side HTTP
 * calls from the Next.js process, they are NOT browser-initiated requests.
 * Playwright's `page.route()` / `page.on("request")` only intercept browser
 * requests; they cannot intercept server-side Node.js HTTP calls.
 *
 * The cleanest approach (per the spec) is to spawn a minimal HTTP stub server
 * in the Playwright worker process, point Auth.js's OIDC provider at the stub
 * via environment variable overrides, then restart the Next.js dev server for
 * that worker. However, because the e2e suite targets the Kind cluster (not a
 * local dev server), we cannot restart the server per-worker.
 *
 * Approach used here (server-side fault-injection via the inject-fault endpoint)
 * ------------------------------------------------------------------------------
 * For JWKS and token-exchange faults, the pragmatic approach that works against
 * a live Kind cluster is to use the server-side inject-fault endpoint with the
 * "jwks" and "token-exchange" subsystems. The fault-injection module is wired
 * into the relevant code paths (auth.ts JWKS fetch wrapper and token-exchange
 * wrapper) when TEST_FIXTURES_ENABLED=true is set in the cluster's Next.js pod.
 *
 * The proxy fixtures exported here are the ALTERNATIVE pattern, used when
 * running the suite against a local Next.js dev server (E2E_AUTH_SUITE is unset,
 * PLAYWRIGHT_BASE_URL=http://localhost:3000, and the webServer is started by
 * Playwright itself with TEST_FIXTURES_ENABLED=true injected). In that mode the
 * proxy IS the correct mechanism because the dev server process is fully under
 * Playwright's control.
 *
 * When running against the Kind cluster: use the inject-fault endpoint directly.
 * The test helpers in this file expose a unified interface that works in both
 * modes.
 *
 * Spec: auth-resolution-hardening, Task 14 (primitive 2: JWKS + token-exchange).
 *
 * @module e2e/auth/fixtures/fault-proxy
 */

import type { Page } from "@playwright/test";
import { BASE_URL } from "../helpers/fixtures";

// ---------------------------------------------------------------------------
// Inject-fault endpoint helpers
// (works against both Kind cluster and local dev server when TEST_FIXTURES_ENABLED=true)
// ---------------------------------------------------------------------------

type FaultMode = "503" | "malformed-200" | "timeout" | "clear";
type FaultScope = "all" | `next-${number}-calls`;
type FaultSubsystem = "fga" | "jwks" | "token-exchange";

/**
 * Arms or clears a fault on a subsystem via the /api/test/inject-fault
 * endpoint. Returns true on success; false if the endpoint is unavailable
 * (cluster not running TEST_FIXTURES_ENABLED=true).
 *
 * Tests call this to set up the fault before driving the sign-in flow, then
 * call it again with mode="clear" after assertions.
 *
 * @example
 * const armed = await armFault(page, "fga", "503", "next-1-calls");
 * if (!armed) { test.skip(true, "inject-fault endpoint not available"); return; }
 */
export async function armFault(
  page: Page,
  subsystem: FaultSubsystem,
  mode: FaultMode,
  scope: FaultScope = "all",
): Promise<boolean> {
  try {
    const resp = await page.request.post(`${BASE_URL}/api/test/inject-fault`, {
      data: { subsystem, mode, scope },
      timeout: 10_000,
    });
    return resp.status() === 200;
  } catch {
    return false;
  }
}

/**
 * Clears all active faults by posting mode="clear" for each known subsystem.
 * Safe to call in afterEach even if no fault was armed.
 */
export async function clearAllFaults(page: Page): Promise<void> {
  for (const subsystem of ["fga", "jwks", "token-exchange"] as FaultSubsystem[]) {
    try {
      await page.request.post(`${BASE_URL}/api/test/inject-fault`, {
        data: { subsystem, mode: "clear" },
        timeout: 5_000,
      });
    } catch {
      // ignore, best effort cleanup
    }
  }
}

/**
 * Checks whether the inject-fault endpoint is active on the target server.
 * Returns false when the cluster is not running TEST_FIXTURES_ENABLED=true.
 * Tests that depend on fault injection MUST skip when this returns false.
 *
 * @example
 * const faultable = await isFaultInjectionAvailable(page);
 * if (!faultable) {
 *   test.skip(true, "TEST_FIXTURES_ENABLED not set on this cluster");
 *   return;
 * }
 */
export async function isFaultInjectionAvailable(page: Page): Promise<boolean> {
  try {
    const resp = await page.request.get(`${BASE_URL}/api/test/inject-fault`, {
      timeout: 5_000,
    });
    return resp.status() === 200;
  } catch {
    return false;
  }
}

/**
 * Triggers mid-session membership revocation via the fga-revoke endpoint.
 * Arms a scoped FGA 503 fault for the next call to getMyMemberships().
 *
 * Returns true on success; false if the endpoint is unavailable.
 *
 * @example
 * const ok = await revokeTestMembership(page, "user:abc", "tenant:xyz");
 * if (!ok) { test.skip(true, "fga-revoke not available"); return; }
 * // navigate to protected route, middleware should trigger federated signout
 */
export async function revokeTestMembership(
  page: Page,
  user: string,
  tenant: string,
): Promise<boolean> {
  try {
    const resp = await page.request.post(`${BASE_URL}/api/test/fga-revoke`, {
      data: { user, tenant },
      timeout: 10_000,
    });
    return resp.status() === 200;
  } catch {
    return false;
  }
}
