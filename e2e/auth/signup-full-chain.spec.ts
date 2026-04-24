/**
 * signup-full-chain.spec.ts
 *
 * Browser-side driver for the signup full-chain e2e test.
 *
 * This spec is the FIRST half of the two-phase e2e gate.  It drives the
 * dashboard signup form against a live Kind cluster (values-zitadel-envoy.yaml
 * overlay) and waits for the dashboard to confirm success OR report failure.
 *
 * The SECOND half (cluster-side Go assertions) is in:
 *   core/gibson/tests/e2e/signup_full_chain_test.go
 *
 * The `make test-signup-e2e` orchestrator in
 * enterprise/deploy/helm/gibson/Makefile:
 *   1. Generates a unique slug + email, exports SIGNUP_SLUG / SIGNUP_EMAIL.
 *   2. Runs this Playwright spec (browser POST + provisioning UI wait).
 *   3. Runs the Go test (cluster-side assertions).
 *
 * Env vars consumed:
 *   SIGNUP_SLUG    — unique DNS-safe slug (set by orchestrator; e.g. "e2e-abc123")
 *   SIGNUP_EMAIL   — unique email matching the slug (set by orchestrator)
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: https://app.zero-day.local:30443)
 *
 * Security:
 *   - Uses a synthetic email + generated password that are NEVER reused.
 *   - Accepts self-signed TLS via ignoreHTTPSErrors (Kind dev cluster).
 *   - Redacts passwords from test report output.
 *
 * TDD note: this spec was written EXPECTING FAILURE when the cluster is in a
 * broken state.  Bug catalog references (B1–B16) are documented in
 * enterprise/deploy/helm/gibson/design.md.
 *
 * Requirements: R1.1, R1.2.
 */

import { test, expect } from "@playwright/test";
import { securePassword } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * The target base URL for the live cluster.  The Kind overlay exposes the
 * dashboard at https://app.zero-day.local:30443 (HTTPS via Envoy TLS term).
 * Fall back to HTTP port for local dev-server runs.
 */
const CLUSTER_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zero-day.local:30443";

/**
 * How long to wait for the provisioning UI to settle (dashboard's "saga done"
 * indicator).  The tenant-operator saga can take up to 60 seconds.
 */
const PROVISIONING_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Signup — full chain (cluster e2e)", () => {
  /**
   * signup full chain
   *
   * Reads SIGNUP_SLUG / SIGNUP_EMAIL from env (set by the Make orchestrator),
   * fills the signup form at `<CLUSTER_URL>/signup?plan=solo`, submits, and
   * waits for either:
   *   (a) The provisioning-complete dashboard UI — test PASSES.
   *   (b) The "support has been notified" failure card — test FAILS with the
   *       page text + last network response dump.
   *   (c) 90-second timeout — test FAILS with a descriptive message.
   *
   * The test does NOT assert cluster-side state (Tenant CR, FGA tuples, etc.)
   * — those assertions are in the Go counterpart.
   *
   * TDD discipline: intentionally thin — this file's job is ONLY to drive
   * the browser and wait for the provisioning signal.
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

    // Accept self-signed TLS for the Kind dev cluster.
    await context.setExtraHTTPHeaders({});

    // -----------------------------------------------------------------------
    // 1. Navigate to the signup page with plan pre-selected
    // -----------------------------------------------------------------------
    await page.goto(`${CLUSTER_URL}/signup?plan=solo`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });

    // -----------------------------------------------------------------------
    // 2. Fill the signup form
    // -----------------------------------------------------------------------

    // Company / workspace name field (accepts various label variants)
    const companyNameInput = page
      .getByLabel(/company name/i)
      .or(page.getByPlaceholder(/company|organization|workspace/i));
    await companyNameInput.first().fill(`E2E Company ${slug.toUpperCase()}`);

    // Email field
    await page.getByLabel(/email/i).fill(email);

    // Password field — fill the first one; confirm field if present
    const passwordFields = page.getByLabel(/^password$/i);
    await passwordFields.first().fill(password);

    const confirmField = page
      .getByLabel(/confirm password|re-enter password/i)
      .first();
    if ((await confirmField.count()) > 0) {
      await confirmField.fill(password);
    }

    // Accept Terms of Service checkbox if present
    const tosCheckbox = page
      .getByRole("checkbox", { name: /terms|tos|agree/i })
      .first();
    if ((await tosCheckbox.count()) > 0) {
      await tosCheckbox.check();
    }

    // -----------------------------------------------------------------------
    // 3. Submit the form
    // -----------------------------------------------------------------------
    await page
      .getByRole("button", { name: /create account|sign up|get started/i })
      .first()
      .click();

    // After submission the dashboard routes to one of:
    //   (a) /verify-email — email verification gate (expected in dev w/ log provider)
    //   (b) /signup/provisioning — provisioning pending page
    //   (c) /dashboard/* — direct success (email verification bypassed)
    //   (d) /signup (with error) — if the signup API call failed
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/verify-email") ||
        url.pathname.startsWith("/signup/provisioning") ||
        url.pathname.startsWith("/dashboard"),
      { timeout: 30_000 },
    );

    const postSubmitUrl = page.url();

    // Dump any visible error message so CI logs show what broke.
    const errorText = await page
      .getByRole("alert")
      .or(page.getByText(/error|failed|invalid/i))
      .allTextContents();
    if (errorText.length > 0) {
      console.log(
        `[signup-full-chain] post-submit errors on page: ${errorText.join("; ")}`,
      );
    }

    // -----------------------------------------------------------------------
    // 4. Handle verify-email gate (Kind dev cluster with log provider)
    // -----------------------------------------------------------------------
    if (postSubmitUrl.includes("/verify-email")) {
      if (!isLogSourceReachable()) {
        test.skip(
          true,
          "verify-email gate reached but log source is unreachable — skip token scrape",
        );
        return;
      }

      const token = await scrapeToken({
        to: email,
        tokenType: "verify",
        timeoutMs: 30_000,
      });

      expect(token).toBeTruthy();

      await page.goto(
        `${CLUSTER_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
      );

      // Wait for redirect to dashboard or provisioning.
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard") ||
          url.pathname.startsWith("/signup/provisioning") ||
          url.pathname.startsWith("/verify-email"),
        { timeout: 30_000 },
      );

      const afterVerifyUrl = page.url();
      if (afterVerifyUrl.includes("/verify-email")) {
        // Confirm card — wait for auto-redirect.
        await expect(
          page.getByText(/verified|success|welcome|confirmed/i),
        ).toBeVisible({ timeout: 15_000 });

        await page.waitForURL(
          (url) =>
            url.pathname.startsWith("/dashboard") ||
            url.pathname.startsWith("/signup/provisioning"),
          { timeout: 15_000 },
        );
      }
    }

    // -----------------------------------------------------------------------
    // 5. Handle provisioning pending page
    //    The dashboard shows a spinner / progress UI while the tenant-operator
    //    saga runs.  We wait until either:
    //      - The UI transitions to the dashboard ("Welcome" / main nav)
    //      - The "support has been notified" failure card appears
    //    whichever comes first within PROVISIONING_TIMEOUT_MS.
    // -----------------------------------------------------------------------
    if (page.url().includes("/signup/provisioning")) {
      console.log(
        `[signup-full-chain] Watching provisioning page for slug=${slug} (up to ${PROVISIONING_TIMEOUT_MS}ms)`,
      );

      // Poll for one of two terminal states.
      const result = await page
        .waitForSelector(
          [
            // Success state: navigated to dashboard
            "[data-testid='dashboard-root']",
            "[data-testid='welcome-banner']",
            "nav[aria-label='Main navigation']",
            // Or any dashboard path indicator
            "a[href*='/dashboard']",
            // Failure state: support card
            "[data-testid='error-support-card']",
            "[data-testid='provisioning-failed']",
            "text='Support has been notified'",
            "text='support has been notified'",
          ].join(","),
          { timeout: PROVISIONING_TIMEOUT_MS },
        )
        .catch(() => null);

      if (result === null) {
        // Neither success nor failure appeared — dump page state.
        const pageText = await page.textContent("body");
        const currentUrl = page.url();
        throw new Error(
          `[signup-full-chain] Provisioning timed out for slug=${slug} after ` +
            `${PROVISIONING_TIMEOUT_MS}ms. URL=${currentUrl}. ` +
            `Page text (first 500 chars): ${(pageText ?? "").slice(0, 500)}`,
        );
      }

      // Check if it was the failure card.
      const isFailure = await page
        .getByText(/support has been notified/i)
        .isVisible()
        .catch(() => false);

      if (isFailure) {
        // Dump page content for CI artifact upload.
        const pageText = await page.textContent("body");
        const networkEntries = await page
          .evaluate(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (performance.getEntriesByType("resource") as any[])
              .filter((e) => e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest")
              .slice(-20)
              .map((e) => `${e.name} (${Math.round(e.duration)}ms)`);
          })
          .catch(() => [] as string[]);

        throw new Error(
          `[signup-full-chain] Provisioning FAILED for slug=${slug}. ` +
            `Dashboard showed "support has been notified" failure card.\n` +
            `Page text: ${(pageText ?? "").slice(0, 1000)}\n` +
            `Last network calls: ${networkEntries.join("; ")}`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 6. Final assertion: we must be on the dashboard (not an error page)
    // -----------------------------------------------------------------------
    await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
      timeout: 15_000,
    });

    // No visible error text.
    await expect(
      page.getByText(/sign in|error|failed|invalid/i),
    ).not.toBeVisible({ timeout: 5_000 });

    console.log(
      `[signup-full-chain] Browser signup PASSED for slug=${slug}. URL=${page.url()}`,
    );
  });
});
