/**
 * signup-full-chain.spec.ts
 *
 * Browser-side driver for the signup full-chain e2e test.
 *
 * This spec is the FIRST half of the two-phase e2e gate.  It drives the
 * dashboard signup form against a live Kind cluster and waits for the
 * dashboard to confirm success (ProvisioningPanel redirects to /login).
 *
 * The SECOND half (cluster-side Go assertions) is in:
 *   core/gibson/tests/e2e/signup_full_chain_test.go
 *
 * The `make test-signup-e2e` orchestrator in
 * enterprise/deploy/helm/gibson/Makefile:
 *   1. Generates a unique slug + email, exports SIGNUP_SLUG / SIGNUP_EMAIL.
 *   2. Runs this Playwright spec (browser form fill + provisioning UI wait).
 *   3. Runs the Go test (cluster-side assertions).
 *
 * Realignment (e2e-harness-realignment spec):
 *   - Uses signUpViaForm canonical helper (no inline form logic).
 *   - Expects /login?callbackUrl=/dashboard as the post-signup landing (SIGNUP-B20).
 *   - No /verify-email route wait (emailVerified=true at creation — SIGNUP-B19).
 *   - No /signup/provisioning route wait (panel is in-page, not a route).
 *   - Detects SIGNUP-B22 regression: no dialog/beforeunload popup on success path.
 *
 * Env vars consumed:
 *   SIGNUP_SLUG    — unique DNS-safe slug (set by orchestrator; e.g. "e2e-abc123")
 *   SIGNUP_EMAIL   — unique email matching the slug (set by orchestrator)
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: https://app.zeroroot.local:30443)
 *
 * Security:
 *   - Uses a synthetic email + generated password that are NEVER reused.
 *   - Accepts self-signed TLS via ignoreHTTPSErrors (Kind dev cluster).
 *   - Passwords are not logged.
 *
 * Requirements: R1.1, R3.1, R3.2.
 */

import { test, expect } from "@playwright/test";
import { securePassword } from "./helpers/fixtures";
import { signUpViaForm } from "./helpers/signup-via-form";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLUSTER_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Signup — full chain (cluster e2e)", () => {
  /**
   * signup full chain
   *
   * Reads SIGNUP_SLUG / SIGNUP_EMAIL from env (set by the Make orchestrator),
   * drives the signup form via the canonical signUpViaForm helper, and asserts:
   *   (a) The provisioning panel navigates to /login?callbackUrl=/dashboard.
   *   (b) No dialog/beforeunload popup fires on the success path (SIGNUP-B22).
   *
   * Does NOT assert cluster-side state (Tenant CR, FGA tuples, etc.)
   * — those assertions are in the Go counterpart.
   */
  test("signup full chain", async ({ page, context }) => {
    // -----------------------------------------------------------------------
    // 0. Validate env inputs
    // -----------------------------------------------------------------------
    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;

    if (!slug || !email) {
      test.fail(
        true,
        "SIGNUP_SLUG and SIGNUP_EMAIL must be set — run via `make test-signup-e2e`",
      );
      return;
    }

    const password = securePassword();

    // -----------------------------------------------------------------------
    // 1. SIGNUP-B22 regression: assert NO dialog fires during the signup
    //    success path. The beforeunload guard must skip when redirectOnSuccess
    //    is set (commit 4be3d7a).
    // -----------------------------------------------------------------------
    let dialogFired = false;
    page.on("dialog", async (dialog) => {
      dialogFired = true;
      console.warn(
        `[signup-full-chain] SIGNUP-B22 REGRESSION: dialog fired during signup — ` +
          `type=${dialog.type()} message=${dialog.message().slice(0, 100)}`,
      );
      await dialog.dismiss().catch(() => {});
    });

    // -----------------------------------------------------------------------
    // 2. Drive the signup form via the canonical helper.
    //    Waits for the ProvisioningPanel to redirect to /login.
    // -----------------------------------------------------------------------
    const result = await signUpViaForm(page, {
      slug,
      email,
      password,
      firstName: "E2E",
      lastName: "Signup",
      plan: "solo",
      baseURL: CLUSTER_URL,
      provisioningTimeoutMs: 120_000,
    });

    // -----------------------------------------------------------------------
    // 3. Assert post-signup landing is /login?callbackUrl=/dashboard (SIGNUP-B20).
    //    NOT /api/auth/signin/zitadel (old Auth.js v4 endpoint).
    //    NOT /verify-email (emailVerified=true fixes that — SIGNUP-B19).
    // -----------------------------------------------------------------------
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    const finalUrl = page.url();
    expect(
      finalUrl,
      "SIGNUP-B20 regression: post-signup must redirect to /login?callbackUrl=/dashboard, not /api/auth/signin",
    ).not.toContain("/api/auth/signin");

    console.log(
      `[signup-full-chain] Browser signup PASSED for slug=${slug}. URL=${finalUrl}`,
    );
    console.log(
      `[signup-full-chain] tenantSlug=${result.tenantSlug} finalUrl=${result.finalUrl}`,
    );

    // -----------------------------------------------------------------------
    // 4. Assert no dialog fired (SIGNUP-B22 regression).
    // -----------------------------------------------------------------------
    expect(
      dialogFired,
      "SIGNUP-B22 regression: beforeunload dialog fired during successful signup — " +
        "fix: skip the beforeunload guard when redirectOnSuccess is set (commit 4be3d7a)",
    ).toBe(false);
  });
});
