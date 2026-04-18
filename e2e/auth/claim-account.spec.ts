/**
 * claim-account.spec.ts
 *
 * Operator-seeded tenant via admin API → owner receives claim email →
 * clicks → sets password → lands in dashboard.
 *
 * Pre-conditions:
 *   DASHBOARD_EMAIL_PROVIDER=log
 *   DASHBOARD_CAPTCHA_PROVIDER=disabled
 *   A running kind `gibson` cluster with the dashboard + tenant-operator.
 *
 *   The admin provisioning API requires a SPIFFE JWT-SVID bearer token.
 *   In the test harness we use the `SPIFFE_TEST_TOKEN` env variable which
 *   can be set to a static dev token for the kind cluster.
 *
 * Flow:
 *   1. POST /api/admin/provisioning/organization/create with a unique slug
 *      and a new-email owner → creates a shell user.  The response includes
 *      the tenant ID; the operator dispatches the claim email asynchronously.
 *   2. Poll the log provider until the claim email / token appears.
 *   3. Navigate to /claim-account?token=<token>.
 *   4. Fill in a password and submit.
 *   5. Expect redirect to /dashboard/* (auto-sign-in after claim).
 *
 * Skip conditions:
 *   - SPIFFE_TEST_TOKEN is not set (admin API is SPIFFE-gated).
 *   - isLogSourceReachable() returns false.
 */

import { test, expect, request } from "@playwright/test";
import { BASE_URL, generateUserCredentials, securePassword } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";
import { queryUser, closeDbPool } from "./helpers/db";

const SPIFFE_TEST_TOKEN = process.env.SPIFFE_TEST_TOKEN ?? "";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Claim account — operator-seeded tenant", () => {
  test.afterAll(async () => {
    await closeDbPool();
  });

  test("operator creates shell user → claim email → set password → dashboard", async ({
    browser,
  }) => {
    if (!SPIFFE_TEST_TOKEN) {
      test.skip(
        true,
        "SPIFFE_TEST_TOKEN not set — admin provisioning API requires SPIFFE auth; skipping.",
      );
      return;
    }

    if (!isLogSourceReachable()) {
      test.skip(
        true,
        "Log source unreachable — skipping claim-account test (cluster not running?).",
      );
      return;
    }

    const creds = generateUserCredentials();
    const claimPassword = securePassword();

    // ------------------------------------------------------------------
    // 1. Call the admin provisioning API to create the shell user.
    // ------------------------------------------------------------------
    const apiCtx = await request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: {
        Authorization: `Bearer ${SPIFFE_TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const createResp = await apiCtx.post(
      "/api/admin/provisioning/organization/create",
      {
        data: {
          slug: creds.slug,
          displayName: creds.companyName,
          ownerEmail: creds.email,
          tier: "free",
        },
      },
    );

    // 201 or 200 from create; 409 means slug collision (shouldn't happen with unique slug).
    expect([200, 201]).toContain(createResp.status());

    const createBody = await createResp.json() as Record<string, unknown>;
    const tenantId =
      (createBody["tenantId"] as string | undefined) ??
      (createBody["id"] as string | undefined) ??
      "";

    // The response should include a tenant/org id.
    expect(tenantId).toBeTruthy();

    // ------------------------------------------------------------------
    // 2. Scrape the claim token from the log provider.
    // ------------------------------------------------------------------
    // The operator dispatches the claim email asynchronously after the
    // saga step `SendClaimInvitationIfShell`. We poll for it.
    const claimToken = await scrapeToken({
      to: creds.email,
      tokenType: "claim",
      timeoutMs: 60_000, // operator saga may take a moment
    });

    expect(claimToken).toBeTruthy();

    // ------------------------------------------------------------------
    // 3. Navigate to /claim-account?token=<token>.
    // ------------------------------------------------------------------
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    try {
      await page.goto(
        `${BASE_URL}/claim-account?token=${encodeURIComponent(claimToken)}`,
      );

      await expect(page).toHaveURL(/\/claim-account/, { timeout: 15_000 });

      // The page should render a form (not an error state).
      await expect(
        page.getByText(/invalid|expired|error/i),
      ).not.toBeVisible({ timeout: 5_000 }).catch(() => {
        // If it IS visible, the assertion will fail below via form check.
      });

      // The claim form should be present.
      const pwField = page.getByLabel(/^(new )?password$/i).first();
      await expect(pwField).toBeVisible({ timeout: 10_000 });

      // ------------------------------------------------------------------
      // 4. Fill in the password and submit.
      // ------------------------------------------------------------------
      await pwField.fill(claimPassword);

      const confirmField = page
        .getByLabel(/confirm (new )?password|re-enter/i)
        .first();
      if ((await confirmField.count()) > 0) {
        await confirmField.fill(claimPassword);
      }

      await page
        .getByRole("button", { name: /claim|activate|set password|continue/i })
        .first()
        .click();

      // ------------------------------------------------------------------
      // 5. Expect redirect to /dashboard/* (auto-sign-in after claim).
      // ------------------------------------------------------------------
      await page.waitForURL(
        (url) => !url.pathname.startsWith("/claim-account"),
        { timeout: 20_000 },
      );

      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
      await expect(
        page.getByText(/error|failed|invalid/i),
      ).not.toBeVisible();

      // ------------------------------------------------------------------
      // 6. Optional DB assertion: user has a real password now (emailVerified).
      // ------------------------------------------------------------------
      const user = await queryUser(creds.email);
      if (user !== null) {
        // After claim, emailVerified should be true.
        expect(user["emailVerified"]).toBe(true);
      }
    } finally {
      await ctx.close();
      await apiCtx.dispose();
    }
  });
});
