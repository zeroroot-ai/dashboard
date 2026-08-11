/**
 * signup-via-form.ts, canonical helper that drives the real Gibson signup form.
 *
 * ONE set of functions, no per-spec `ensureUserExists` reimplementations. All
 * spec files that need a fresh signed-up user import from here.
 *
 * The signup flow is now TWO screens (dashboard#991, gibson#1228 — "verify
 * the email address before creating anything"), not one:
 *
 *   1. `/signup?plan=<plan>` — collects firstName, lastName, email,
 *      workspaceName, acceptToS, acceptPrivacy. NO password field and NO
 *      card field here (source of truth: app/(public)/signup/signup-form.tsx,
 *      app/(public)/signup/types.ts `signupInputSchema`). Submitting asks the
 *      daemon to email a single-use verification link and creates nothing:
 *      no account, no billing customer, no SetupIntent, no workspace. The
 *      screen's terminal state is a "Check your email" card — there is no
 *      in-page ProvisioningPanel here any more, and critically, no Stripe
 *      Payment Element ever mounts on this screen (source of truth:
 *      app/(public)/signup/signup-form.tsx has no <Elements> / <PaymentElement>
 *      import at all). That absence IS the "no Stripe customer created yet"
 *      assertion — the client-side surface that would create one is not
 *      present in the DOM.
 *
 *   2. `/signup/verify?token=<token>` — a Route Handler (app/(public)/signup/verify/route.ts),
 *      not a page. GET-only, no form to drive. Redeems the token (single-use;
 *      a second redemption redirects to the SAME failure destination as every
 *      other invalid-token case), sets the short-lived `SIGNUP_VERIFIED_COOKIE`
 *      httpOnly cookie, and redirects to `/signup/complete` on success or
 *      `/signup?verify=invalid` on any failure (absent/unknown/expired/
 *      already-used token — one destination for all of them, by design, so
 *      redemption cannot be used to probe which signups exist).
 *
 *   3. `/signup/complete` — collects password (+ card, on the paid profile).
 *      Reachable ONLY via the cookie `/signup/verify` sets; visiting directly
 *      redirects to `/signup?verify=invalid` (app/(public)/signup/complete/page.tsx).
 *      The Stripe customer + SetupIntent are created here, strictly after
 *      verification — the Payment Element mounting on THIS screen (never on
 *      `/signup`) is the other half of the "customer created only after
 *      verification" assertion. Submitting drives the same <ProvisioningPanel>
 *      component the old single-screen flow used, just relocated here; it
 *      still polls /api/signup/progress/:id and window.location.assign's to
 *      /login?callbackUrl=/dashboard on success.
 *
 * Why this file cannot fully automate the round-trip by itself
 * --------------------------------------------------------------
 * Step 2 requires a REAL single-use token that only exists inside an email
 * the daemon sent. There is deliberately no test-only bypass for this: the
 * daemon's `GIBSON_EMAIL_PROVIDER=log` transport is a NON-delivering dev stub
 * that never logs the token or message body (see
 * `enterprise/platform/gibson/internal/platform/mailer/mailer.go` `LogMailer`,
 * "the application log is a lower-trust, widely-shipped sink ... writing the
 * body there hands anyone with log read access a working account-takeover
 * link") and `Delivers()` reports false, so `resolveSignupMailer` refuses to
 * wire it for signup at all — `RequestEmailVerification` fails closed with
 * `FailedPrecondition` rather than emitting a scrapeable link (unlike the
 * older, now-dead `/verify-email` Auth.js-era flow that `e2e/auth/verify-email.spec.ts`
 * drove via log-scraping; that flow and that route no longer exist).
 *
 * So: getting a real token requires a real SMTP transport and out-of-band
 * mail capture, which is cluster/orchestrator infrastructure this repo does
 * not currently provide. `requestSignupVerification` below drives everything
 * that CAN run unconditionally (the whole of step 1, for real, against a live
 * cluster). `redeemAndCompleteSignup` drives steps 2+3 and requires a real
 * token to be supplied; `signUpViaForm` is the convenience wrapper that chains
 * both and throws `SignupRequiresVerificationTokenError` — a distinct,
 * catchable type — when no token is available, so callers can `test.skip`
 * with a clear reason instead of failing on a confusing timeout. The
 * orchestrator env var is `SIGNUP_VERIFY_TOKEN`, parallel to the existing
 * `SIGNUP_SLUG` / `SIGNUP_EMAIL` convention; wiring a real mail-capture step
 * to populate it is tracked as follow-up infrastructure, not part of this
 * helper.
 *
 * Security:
 *   - Passwords are never logged (only presence).
 *   - Cookie values are never logged.
 *   - Verification tokens are never logged in full (see `redactToken`).
 *
 * Requirements: R3.1, R3.2. Issue: dashboard#992.
 */

import { type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignUpOptions {
  /** DNS-safe workspace slug. Used as the workspace name base. */
  slug: string;
  /** Email address for the new user. */
  email: string;
  /** Password for the new user. Must satisfy Zitadel's password policy. */
  password: string;
  /** First name (default: "E2E"). */
  firstName?: string;
  /** Last name (default: "User"). */
  lastName?: string;
  /**
   * Plan to select (default: "team", the first self-serve tier — see
   * src/generated/plans.ts). On the SaaS profile an invalid plan bounces
   * /signup to the marketing pricing page, which the helper reports as a
   * clear error.
   */
  plan?: string;
  /** Base URL of the cluster (default: PLAYWRIGHT_BASE_URL env var or https://app.zeroroot.local:30443). */
  baseURL?: string;
  /** How long to wait for the provisioning panel to redirect (ms, default: 120_000). */
  provisioningTimeoutMs?: number;
  /**
   * Real single-use verification token, obtained out-of-band (real mail
   * transport + capture). Defaults to `process.env.SIGNUP_VERIFY_TOKEN`.
   * Without one, `signUpViaForm` cannot proceed past the "Check your email"
   * screen and throws `SignupRequiresVerificationTokenError`.
   */
  verifyToken?: string;
}

export interface SignUpResult {
  /** The tenant slug resolved by the provisioning saga. */
  tenantSlug: string;
  /** Final URL after provisioning (should be /login?callbackUrl=/dashboard). */
  finalUrl: string;
}

/** Terminal state of the step-one ("send the link") screen. */
export interface SendVerificationResult {
  /** The address the "Check your email" card echoed back. */
  email: string;
}

/**
 * Thrown by `signUpViaForm` when no real verification token is available.
 * Distinct type so callers can `test.skip` with a clear, actionable reason
 * instead of the run failing on an opaque timeout waiting for a redirect
 * that was never going to happen without a real inbox.
 */
export class SignupRequiresVerificationTokenError extends Error {
  constructor(email: string) {
    super(
      `[signUpViaForm] "${email}" — verification link was requested but no ` +
        `real token is available to redeem it. The two-step signup flow ` +
        `(dashboard#991) requires a real mail transport and out-of-band ` +
        `token capture; there is no test-only bypass (see the file header ` +
        `of signup-via-form.ts for why). Pass { verifyToken } or set ` +
        `SIGNUP_VERIFY_TOKEN to drive the verify + complete steps.`,
    );
    this.name = "SignupRequiresVerificationTokenError";
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

/** Never put a full token in a log line or thrown error. */
function redactToken(token: string): string {
  if (token.length <= 8) return "***";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

/**
 * requestSignupVerification, drives step ONE of signup: `/signup`.
 *
 * Fills the account-detail fields, submits, and waits for the "Check your
 * email" terminal state. Asserts no Stripe Payment Element is present on
 * this screen (dashboard#992: "the link-send step asserts NO Stripe customer
 * is created" — step one's form has no card field or Stripe mount point at
 * all, so this assertion is really "the DOM never offered a way to create
 * one here").
 *
 * Creates nothing server-side: no account, no billing customer, no
 * workspace. Safe to call from any spec, cluster or not (network errors
 * surface as a normal Playwright timeout/assertion failure).
 *
 * @param page  Playwright Page (context should have ignoreHTTPSErrors=true
 *              against the kind dev cluster's self-signed TLS).
 * @param opts  Signup options. `password` is accepted but unused here (kept
 *              on `SignUpOptions` because it is needed by
 *              `redeemAndCompleteSignup`); step one has no password field.
 */
export async function requestSignupVerification(
  page: Page,
  opts: SignUpOptions,
): Promise<SendVerificationResult> {
  const {
    slug,
    email,
    firstName = "E2E",
    lastName = "User",
    plan = "team",
    baseURL = DEFAULT_BASE_URL,
  } = opts;

  const workspaceName = slug;

  // ---------------------------------------------------------------------
  // 1. Navigate to /signup
  // ---------------------------------------------------------------------
  await page.goto(`${baseURL}/signup?plan=${plan}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // ---------------------------------------------------------------------
  // 1b. Front-door shape detection (dashboard#961), unchanged from the
  //     single-screen era: /signup either renders the form, redirects to
  //     /login (self-serve disabled), or bounces off-host to the marketing
  //     pricing page (missing/invalid plan on the SaaS profile).
  // ---------------------------------------------------------------------
  const firstNameInput = page.getByLabel(/first name/i).first();
  const baseHost = new URL(baseURL).hostname;

  let formReady = false;
  const shapeDeadline = Date.now() + 15_000;
  while (Date.now() < shapeDeadline) {
    const current = new URL(page.url());
    if (current.pathname.startsWith("/login")) {
      throw new Error(
        `[requestSignupVerification] /signup redirected to /login — this ` +
          `deployment profile has self-serve signup disabled ` +
          `(SIGNUP_SELF_SERVE unset). There is no signup path to drive. ` +
          `URL=${page.url()}`,
      );
    }
    if (current.hostname !== baseHost) {
      throw new Error(
        `[requestSignupVerification] /signup?plan=${plan} bounced off-host ` +
          `to ${page.url()} — the SaaS profile rejected the plan (marketing ` +
          `pricing redirect). Pass a valid self-serve plan id (e.g. "team").`,
      );
    }
    if (await firstNameInput.isVisible().catch(() => false)) {
      formReady = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!formReady) {
    throw new Error(
      `[requestSignupVerification] Timed out waiting for the signup form to ` +
        `render. URL=${page.url()}. Expected a "First name" field, a ` +
        `redirect to /login, or an off-host pricing bounce.`,
    );
  }

  // ---------------------------------------------------------------------
  // 2. There must be NO Stripe Payment Element anywhere on this screen.
  //    Checked before filling anything: the form has no Stripe import at
  //    all, so this should never appear regardless of billing profile.
  // ---------------------------------------------------------------------
  const stripeIframeOnSendScreen = await page
    .locator('iframe[title="Secure payment input frame"]')
    .count();
  if (stripeIframeOnSendScreen > 0) {
    throw new Error(
      `[requestSignupVerification] SIGNUP-992 REGRESSION: a Stripe payment ` +
        `iframe is present on /signup (step one). Step one must never be ` +
        `able to create a billing customer — the card moved to ` +
        `/signup/complete, which only renders after email verification.`,
    );
  }

  // ---------------------------------------------------------------------
  // 3. Fill the account-detail fields (no password, no card field exists).
  // ---------------------------------------------------------------------
  await firstNameInput.fill(firstName);
  await page.getByLabel(/last name/i).fill(lastName);
  await page.getByLabel(/work email/i).fill(email);
  await page.getByLabel(/workspace name|company name/i).fill(workspaceName);
  await page.locator("#acceptToS").check();
  await page.locator("#acceptPrivacy").check();

  // ---------------------------------------------------------------------
  // 4. Submit ("Continue", not "Create account" — step one creates nothing).
  // ---------------------------------------------------------------------
  const submitButton = page
    .getByRole("button", { name: /continue/i })
    .first();
  await submitButton.scrollIntoViewIfNeeded();
  await submitButton.click({ timeout: 30_000 });

  // ---------------------------------------------------------------------
  // 5. Wait for the "Check your email" terminal state
  //    (app/(public)/signup/signup-form.tsx renders this in-place, no
  //    route change — it replaces the form inside the same Card).
  // ---------------------------------------------------------------------
  await page
    .getByRole("heading", { name: /check your email/i })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.getByText(email, { exact: false }).first().waitFor({
    state: "visible",
    timeout: 5_000,
  });

  // ---------------------------------------------------------------------
  // 6. Re-assert no Stripe iframe appeared after submission either.
  // ---------------------------------------------------------------------
  const stripeIframeAfterSubmit = await page
    .locator('iframe[title="Secure payment input frame"]')
    .count();
  if (stripeIframeAfterSubmit > 0) {
    throw new Error(
      `[requestSignupVerification] SIGNUP-992 REGRESSION: a Stripe payment ` +
        `iframe appeared after submitting /signup. No billing object may be ` +
        `created before the address is verified.`,
    );
  }

  console.log(
    `[requestSignupVerification] "Check your email" reached for slug=${slug} email=${email}. ` +
      `No account, billing customer, or workspace created yet.`,
  );

  return { email };
}

/**
 * redeemAndCompleteSignup, drives steps TWO and THREE: redeeming a real
 * verification token at `/signup/verify`, then filling password (+ card on
 * the paid profile) at `/signup/complete`.
 *
 * Requires `opts.verifyToken` (or `SIGNUP_VERIFY_TOKEN`) to already be a
 * REAL, unredeemed token — this function does not and cannot mint one, see
 * the file header. Throws `SignupRequiresVerificationTokenError` if absent.
 */
export async function redeemAndCompleteSignup(
  page: Page,
  opts: SignUpOptions,
): Promise<SignUpResult> {
  const {
    slug,
    email,
    password,
    baseURL = DEFAULT_BASE_URL,
    provisioningTimeoutMs = 120_000,
  } = opts;

  const verifyToken = opts.verifyToken ?? process.env.SIGNUP_VERIFY_TOKEN;
  if (!verifyToken) {
    throw new SignupRequiresVerificationTokenError(email);
  }

  // -------------------------------------------------------------------------
  // 1. Redeem the token. Success redirects to /signup/complete; ANY failure
  //    (absent/unknown/expired/already-used) redirects to /signup?verify=invalid
  //    — one destination for every failure mode, by design.
  // -------------------------------------------------------------------------
  await page.goto(
    `${baseURL}/signup/verify?token=${encodeURIComponent(verifyToken)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );

  const postRedeemPath = new URL(page.url()).pathname;
  if (postRedeemPath !== "/signup/complete") {
    throw new Error(
      `[redeemAndCompleteSignup] Redeeming verification token ` +
        `${redactToken(verifyToken)} did not reach /signup/complete ` +
        `(landed on ${page.url()} instead). The token may be invalid, ` +
        `expired, or already redeemed.`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Fill password (+confirm). No email, password strength meter, or card
  //    field carries the address/company/plan — the daemon reads all of that
  //    back from the verification row via the session cookie.
  // -------------------------------------------------------------------------
  const passwordInput = page.getByLabel(/^password$/i).first();
  await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
  await passwordInput.fill(password);
  await page.getByLabel(/confirm password/i).fill(password);

  // -------------------------------------------------------------------------
  // 2b. Card-first SaaS profile (dashboard#784/#785): the inline Payment
  //     Element renders on THIS screen (never on /signup) once
  //     startSignupPayment's SetupIntent resolves. Absent on the card-free
  //     profile (kind dev / self-hosted). This is the other half of the
  //     "customer created only after verification" assertion: the Element
  //     that would create the SetupIntent + customer literally cannot mount
  //     before this point in the flow.
  // -------------------------------------------------------------------------
  const paymentLabel = page.getByText(/^payment method$/i).first();
  if (await paymentLabel.isVisible().catch(() => false)) {
    console.log(
      `[redeemAndCompleteSignup] inline Payment Element detected (card-first profile), filling Stripe test card`,
    );
    const paymentIframes = page.locator(
      'iframe[title="Secure payment input frame"]',
    );
    await paymentIframes.first().waitFor({ state: "visible", timeout: 30_000 });

    const cardNumberPlaceholder = /card number|1234 1234/i;
    let stripeFrame: ReturnType<Page["frameLocator"]> | null = null;
    const cardDeadline = Date.now() + 30_000;
    while (Date.now() < cardDeadline && !stripeFrame) {
      const frameCount = await paymentIframes.count();
      for (let i = 0; i < frameCount; i++) {
        const candidate = paymentIframes.nth(i).contentFrame();
        const hasCardField = await candidate
          .getByPlaceholder(cardNumberPlaceholder)
          .count()
          .catch(() => 0);
        if (hasCardField > 0) {
          stripeFrame = candidate;
          break;
        }
      }
      if (!stripeFrame) await page.waitForTimeout(500);
    }
    if (!stripeFrame) {
      throw new Error(
        `[redeemAndCompleteSignup] Payment Element present but no ` +
          `card-number field found in any Stripe iframe within 30s.`,
      );
    }

    await stripeFrame
      .getByPlaceholder(cardNumberPlaceholder)
      .fill("4242424242424242");
    await stripeFrame.getByPlaceholder(/mm ?\/ ?yy/i).fill("12 / 34");
    await stripeFrame.getByPlaceholder(/cvc/i).fill("123");
    const country = stripeFrame.getByLabel(/country/i).first();
    if (await country.isVisible().catch(() => false)) {
      await country
        .selectOption("US")
        .catch(() => country.selectOption({ label: "United States" }))
        .catch(() => undefined);
    }
    const zip = stripeFrame
      .getByLabel(/zip|postal/i)
      .or(stripeFrame.getByPlaceholder(/zip|postal/i))
      .first();
    if (
      await zip
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      await zip.fill("42424").catch(() => undefined);
    }
  }

  // -------------------------------------------------------------------------
  // 3. Submit ("Create account" — this IS the screen that creates the
  //    account, the billing customer, and the workspace).
  // -------------------------------------------------------------------------
  let dialogFired = false;
  page.on("dialog", async (dialog) => {
    dialogFired = true;
    console.warn(
      `[redeemAndCompleteSignup] SIGNUP-B22 REGRESSION: dialog fired during ` +
        `completion, type=${dialog.type()} message=${dialog.message().slice(0, 100)}`,
    );
    await dialog.dismiss().catch(() => {});
  });

  const submitButton = page
    .getByRole("button", { name: /create account/i })
    .first();
  await submitButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  await submitButton.click({ timeout: 30_000 });

  const submissionStarted = async (): Promise<boolean> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!page.url().includes("/signup/complete")) return true;
      const btnGone = (await submitButton.count().catch(() => 0)) === 0;
      if (btnGone) return true;
      const btnText = (await submitButton.textContent().catch(() => "")) ?? "";
      if (/creating account/i.test(btnText)) return true;
      const panelVisible = await page
        .getByText(/provisioning|initializing|setting up|spinning up/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (panelVisible) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  let started = await submissionStarted();
  for (let attempt = 1; !started && attempt <= 2; attempt++) {
    console.log(
      `[redeemAndCompleteSignup] click did not start the submission, retrying with a JS-dispatched click (attempt ${attempt}/2)`,
    );
    await submitButton.dispatchEvent("click").catch(() => undefined);
    started = await submissionStarted();
  }
  if (!started) {
    throw new Error(
      `[redeemAndCompleteSignup] "Create account" submission never started ` +
        `after a trusted click + 2 JS-dispatched clicks. URL=${page.url()}.`,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Wait for the ProvisioningPanel to redirect to /login or /dashboard.
  // -------------------------------------------------------------------------
  console.log(
    `[redeemAndCompleteSignup] Waiting up to ${provisioningTimeoutMs}ms for provisioning to complete (slug=${slug})`,
  );

  let sawToast = "";
  const provisioningDeadline = Date.now() + provisioningTimeoutMs;
  let redirected = false;
  while (Date.now() < provisioningDeadline) {
    const p = new URL(page.url()).pathname;
    if (p.startsWith("/login") || p.startsWith("/dashboard")) {
      redirected = true;
      break;
    }
    if (!sawToast) {
      const toasts = await page
        .locator("[data-sonner-toast]")
        .allTextContents()
        .catch(() => [] as string[]);
      const bad = toasts.find((t) =>
        /too many signup attempts|went wrong|denied|failed/i.test(t),
      );
      if (bad) {
        sawToast = bad;
        console.log(`[redeemAndCompleteSignup] failure toast observed: ${bad}`);
      }
    }
    await page.waitForTimeout(1_000);
  }

  if (!redirected) {
    const pageText = await page.textContent("body").catch(() => "");
    const currentUrl = page.url();

    if (sawToast) {
      throw new Error(
        `[redeemAndCompleteSignup] Completion FAILED for slug=${slug}: ` +
          `server rejected the attempt (toast: "${sawToast.slice(0, 200)}"). ` +
          `URL=${currentUrl}.`,
      );
    }

    const hasError =
      (pageText ?? "").toLowerCase().includes("support has been notified") ||
      (pageText ?? "").toLowerCase().includes("try again");
    if (hasError) {
      throw new Error(
        `[redeemAndCompleteSignup] Provisioning FAILED for slug=${slug}. ` +
          `Panel showed error state. URL=${currentUrl}. ` +
          `Page text (first 500 chars): ${(pageText ?? "").slice(0, 500)}.`,
      );
    }

    throw new Error(
      `[redeemAndCompleteSignup] Provisioning timed out for slug=${slug} ` +
        `after ${provisioningTimeoutMs}ms. URL=${currentUrl}. ` +
        `Page text (first 300 chars): ${(pageText ?? "").slice(0, 300)}.`,
    );
  }

  const finalUrl = page.url();

  if (finalUrl.includes("/api/auth/signin")) {
    throw new Error(
      `[redeemAndCompleteSignup] SIGNUP-B20 REGRESSION: post-signup redirect ` +
        `went to ${finalUrl}. Expected /login?callbackUrl=/dashboard.`,
    );
  }

  if (dialogFired) {
    throw new Error(
      `[redeemAndCompleteSignup] SIGNUP-B22 REGRESSION: beforeunload dialog ` +
        `fired during successful completion.`,
    );
  }

  console.log(
    `[redeemAndCompleteSignup] Completion PASSED for slug=${slug}. FinalURL=${finalUrl}`,
  );

  return { tenantSlug: slug, finalUrl };
}

/**
 * assertVerificationTokenIsSingleUse, dashboard#992: "the verify step
 * asserts the token is single-use". Call AFTER a successful
 * `redeemAndCompleteSignup` with the SAME token; re-redeeming must land on
 * the shared failure destination, not on /signup/complete again.
 */
export async function assertVerificationTokenIsSingleUse(
  page: Page,
  verifyToken: string,
  baseURL: string = DEFAULT_BASE_URL,
): Promise<void> {
  await page.goto(
    `${baseURL}/signup/verify?token=${encodeURIComponent(verifyToken)}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 },
  );
  const url = new URL(page.url());
  if (url.pathname === "/signup/complete") {
    throw new Error(
      `[assertVerificationTokenIsSingleUse] SIGNUP-992 REGRESSION: token ` +
        `${redactToken(verifyToken)} redeemed a SECOND time and reached ` +
        `/signup/complete again. Redemption must be single-use.`,
    );
  }
  if (url.pathname !== "/signup" || url.searchParams.get("verify") !== "invalid") {
    throw new Error(
      `[assertVerificationTokenIsSingleUse] Expected the second redemption ` +
        `to land on /signup?verify=invalid, got ${page.url()} instead.`,
    );
  }
}

/**
 * signUpViaForm, convenience wrapper: drives the whole chain end to end.
 *
 * Preserves the pre-#991 call signature and return shape so every existing
 * caller keeps compiling. At RUNTIME it now requires a real verification
 * token (see the file header for why one cannot be minted here) — callers on
 * a cluster without one should catch `SignupRequiresVerificationTokenError`
 * and `test.skip`, the same pattern `e2e/auth/verify-email.spec.ts` already
 * uses for its own (different, now-dead) log-source-unreachable case.
 *
 * @throws {SignupRequiresVerificationTokenError} when no real token is
 *   available (opts.verifyToken and SIGNUP_VERIFY_TOKEN both unset).
 */
export async function signUpViaForm(
  page: Page,
  opts: SignUpOptions,
): Promise<SignUpResult> {
  // Detect if already signed in (landed on dashboard) before doing anything —
  // mirrors the pre-#991 behavior of checking the outcome of the FIRST
  // /signup navigation, which requestSignupVerification performs as its own
  // step 1. A pre-existing session on /signup redirects to /dashboard the
  // same way an authenticated session hitting /login does.
  const baseURL = opts.baseURL ?? DEFAULT_BASE_URL;
  const plan = opts.plan ?? "team";
  await page
    .goto(`${baseURL}/signup?plan=${plan}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    })
    .catch(() => undefined);
  if (page.url().includes("/dashboard")) {
    console.log(
      `[signUpViaForm] Already on dashboard (${page.url()}), user may already exist`,
    );
    return { tenantSlug: opts.slug, finalUrl: page.url() };
  }

  await requestSignupVerification(page, opts);
  return redeemAndCompleteSignup(page, opts);
}

// ---------------------------------------------------------------------------
// Convenience: generate a unique slug for a given email
// ---------------------------------------------------------------------------

/**
 * slugFromEmail converts an email address to a DNS-safe slug.
 * e.g. "e2e-abc123@test.com" → "e2e-abc123"
 */
export function slugFromEmail(email: string): string {
  return email
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 62);
}
