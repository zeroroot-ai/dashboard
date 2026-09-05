/**
 * signup-full-chain.spec.ts
 *
 * Browser-side driver for the signup full-chain e2e test.
 *
 * Drives the CURRENT two-screen signup flow (dashboard#991,
 * gibson#1228 — "verify the email address before creating anything"):
 *
 *   1. `/signup`         — send the verification link. Creates nothing.
 *   2. `/signup/verify`  — redeem the link (single-use).
 *   3. `/signup/complete`— password (+ card), THEN the account/billing
 *                          customer/workspace are created.
 *
 * This spec previously drove the single-screen form that predated #991
 * (password + card collected directly on /signup, no email round-trip).
 * That flow no longer exists; see e2e/auth/helpers/signup-via-form.ts for
 * the full account of what changed and why step 2 cannot be automated
 * without a real mail transport (dashboard#992).
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
 * Env vars consumed:
 *   SIGNUP_SLUG          , unique DNS-safe slug (set by orchestrator; e.g. "e2e-abc123")
 *   SIGNUP_EMAIL         , unique email matching the slug (set by orchestrator)
 *   SIGNUP_VERIFY_TOKEN  , OPTIONAL. A real, unredeemed single-use verification
 *                          token for SIGNUP_EMAIL, obtained out-of-band (real
 *                          SMTP transport + mail capture — infrastructure this
 *                          repo does not yet wire into the orchestrator). When
 *                          absent, the send-link assertions still run for
 *                          real, and the verify/complete/single-use assertions
 *                          are skipped with a clear reason rather than failing
 *                          on a timeout waiting for a redirect that could
 *                          never happen.
 *   PLAYWRIGHT_BASE_URL  , target cluster URL (default: https://app.zeroroot.local:30443)
 *
 * Security:
 *   - Uses a synthetic email + generated password that are NEVER reused.
 *   - Accepts self-signed TLS via ignoreHTTPSErrors (Kind dev cluster).
 *   - Passwords and verification tokens are not logged in full.
 *
 * Requirements: R1.1, R3.1, R3.2. Issue: dashboard#992.
 */

import { test, expect } from "@playwright/test";
import { securePassword } from "./helpers/fixtures";
import {
  requestSignupVerification,
  redeemAndCompleteSignup,
  assertVerificationTokenIsSingleUse,
  SignupRequiresVerificationTokenError,
} from "./helpers/signup-via-form";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLUSTER_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe("Signup, full chain (cluster e2e)", () => {
  /**
   * signup full chain
   *
   * Reads SIGNUP_SLUG / SIGNUP_EMAIL from env (set by the Make orchestrator).
   * Always drives and asserts step 1 for real. Steps 2+3 (and the single-use
   * assertion) run only when SIGNUP_VERIFY_TOKEN is available; otherwise they
   * are skipped with a clear, actionable reason.
   *
   * Asserts (dashboard#992):
   *   (a) the send-link step (/signup) never offers a way to create a Stripe
   *       customer — no Payment Element in its DOM, before or after submit.
   *   (b) [requires SIGNUP_VERIFY_TOKEN] the completion step (/signup/complete)
   *       is where the Payment Element (and therefore the customer) first
   *       appears — i.e. a customer is created only after verification.
   *   (c) [requires SIGNUP_VERIFY_TOKEN] the verification token is single-use:
   *       redeeming it again after a successful completion does NOT reach
   *       /signup/complete a second time.
   *   (d) [requires SIGNUP_VERIFY_TOKEN] the provisioning panel navigates to
   *       /login?callbackUrl=/dashboard, and no dialog/beforeunload popup
   *       fires on the success path (SIGNUP-B22).
   */
  test("signup full chain", async ({ page }) => {
    // -----------------------------------------------------------------------
    // 0. Validate env inputs
    // -----------------------------------------------------------------------
    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;

    if (!slug || !email) {
      test.fail(
        true,
        "SIGNUP_SLUG and SIGNUP_EMAIL must be set, run via `make test-signup-e2e`",
      );
      return;
    }

    const password = securePassword();

    // -----------------------------------------------------------------------
    // 1. Drive /signup (send the verification link). Asserts, as part of
    //    requestSignupVerification itself, that no Stripe Payment Element is
    //    present on this screen before or after submission.
    // -----------------------------------------------------------------------
    await requestSignupVerification(page, {
      slug,
      email,
      password,
      firstName: "E2E",
      lastName: "Signup",
      plan: "solo",
      baseURL: CLUSTER_URL,
    });

    console.log(
      `[signup-full-chain] "Check your email" reached for slug=${slug}. ` +
        `No Stripe customer created (step one has no Payment Element).`,
    );

    // -----------------------------------------------------------------------
    // 2. Steps 2+3 need a real, unredeemed verification token. Skip with a
    //    clear reason rather than hang waiting for a redirect that can never
    //    come — mirrors the isLogSourceReachable() skip pattern already used
    //    by e2e/auth/verify-email.spec.ts for its own unreachable-source case.
    // -----------------------------------------------------------------------
    const verifyToken = process.env.SIGNUP_VERIFY_TOKEN;
    if (!verifyToken) {
      test.skip(
        true,
        "SIGNUP_VERIFY_TOKEN not set: the verify/complete/single-use " +
          "assertions need a real, unredeemed verification token, which " +
          "requires a real mail transport and out-of-band capture (there is " +
          "no test-only bypass by design, see signup-via-form.ts). The " +
          "send-link assertions above already ran and passed.",
      );
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Redeem the token and complete signup. Asserts the Payment Element
    //    only appears here (customer created only after verification), the
    //    post-signup redirect (SIGNUP-B20), and no beforeunload dialog
    //    (SIGNUP-B22).
    // -----------------------------------------------------------------------
    let dialogFired = false;
    page.on("dialog", async (dialog) => {
      dialogFired = true;
      await dialog.dismiss().catch(() => {});
    });

    const result = await redeemAndCompleteSignup(page, {
      slug,
      email,
      password,
      baseURL: CLUSTER_URL,
      provisioningTimeoutMs: 120_000,
      verifyToken,
    });

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    const finalUrl = page.url();
    expect(
      finalUrl,
      "SIGNUP-B20 regression: post-signup must redirect to /login?callbackUrl=/dashboard, not /api/auth/signin",
    ).not.toContain("/api/auth/signin");
    expect(
      dialogFired,
      "SIGNUP-B22 regression: beforeunload dialog fired during successful signup completion",
    ).toBe(false);

    console.log(
      `[signup-full-chain] Completion PASSED for slug=${slug}. URL=${finalUrl}`,
    );
    console.log(
      `[signup-full-chain] tenantSlug=${result.tenantSlug} finalUrl=${result.finalUrl}`,
    );

    // -----------------------------------------------------------------------
    // 4. Single-use assertion: redeeming the SAME token again must not reach
    //    /signup/complete a second time.
    // -----------------------------------------------------------------------
    await assertVerificationTokenIsSingleUse(page, verifyToken, CLUSTER_URL);
    console.log(
      `[signup-full-chain] Single-use assertion PASSED for slug=${slug}.`,
    );
  });

  /**
   * Defensive regression test for signUpViaForm's failure mode: asserts the
   * helper throws the distinct, catchable error type when no verification
   * token is available, rather than hanging or throwing something generic
   * that a caller can't distinguish from a real cluster failure. Runs
   * without SIGNUP_VERIFY_TOKEN (the common case pre-mail-capture-infra).
   */
  test("redeemAndCompleteSignup without a token throws SignupRequiresVerificationTokenError", async ({
    page,
  }) => {
    test.skip(
      !!process.env.SIGNUP_VERIFY_TOKEN,
      "SIGNUP_VERIFY_TOKEN is set in this run; the no-token failure mode is not exercised.",
    );

    const slug = process.env.SIGNUP_SLUG ?? "e2e-no-token-check";
    const email = process.env.SIGNUP_EMAIL ?? "e2e-no-token-check@test.invalid";

    await expect(
      redeemAndCompleteSignup(page, {
        slug,
        email,
        password: securePassword(),
        baseURL: CLUSTER_URL,
        // deliberately no verifyToken, and SIGNUP_VERIFY_TOKEN is unset
      }),
    ).rejects.toBeInstanceOf(SignupRequiresVerificationTokenError);
  });
});
