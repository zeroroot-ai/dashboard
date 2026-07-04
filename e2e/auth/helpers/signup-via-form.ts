/**
 * signup-via-form.ts, canonical helper that drives the real Gibson signup form.
 *
 * ONE function, no per-spec `ensureUserExists` reimplementations. All four
 * Playwright spec files import this instead of inline form logic.
 *
 * The form fields (source of truth: app/(public)/signup/signup-form.tsx):
 *   firstName, lastName, email, password, passwordConfirm, workspaceName,
 *   acceptToS (checkbox), acceptPrivacy (checkbox)
 *
 * The signup flow:
 *   1. Navigate to /signup?plan=<plan>
 *   2. Fill the form fields
 *   3. Click "Create account"
 *   4. The dashboard renders <ProvisioningPanel> in-page (no route change)
 *   5. Panel polls /api/signup/progress/:id and eventually calls
 *      window.location.assign to /login?callbackUrl=/dashboard
 *
 * Front-door shapes (dashboard#961): /signup renders differently per
 * deployment profile, so step 1 is shape-aware:
 *   - form: the signup form renders directly (kind dev + SaaS with a valid
 *     ?plan=). Steps 2+ run unchanged.
 *   - login-only: selfServeSignup=false profiles redirect /signup → /login.
 *     Fail with a clear error (there is no signup path to drive).
 *   - pricing bounce: the SaaS profile redirects to the marketing pricing
 *     host when ?plan= is missing/invalid. Fail with a clear error naming
 *     the rejected plan.
 *   (Verified against staging 2026-07-04: /signup never renders a
 *   gate-with-CTA shape — the gate page is /login only.)
 *
 * Card-first SaaS profile (dashboard#784/#785): the inline Stripe Payment
 * Element renders inside the form and "Create account" stays disabled until
 * the card is complete. When the element is present, the helper fills the
 * Stripe TEST card 4242 4242 4242 4242 (the SaaS profile runs Stripe in test
 * mode on staging; a live-mode deployment would decline this card, which is
 * the safe failure).
 *
 * Security:
 *   - Passwords are never logged (only presence).
 *   - Cookie values are never logged.
 *
 * Requirements: R3.1, R3.2.
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
}

export interface SignUpResult {
  /** The tenant slug resolved by the provisioning saga. */
  tenantSlug: string;
  /** Final URL after provisioning (should be /login?callbackUrl=/dashboard). */
  finalUrl: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

/**
 * signUpViaForm, drives the Gibson signup form against the live cluster.
 *
 * Returns the resolved { tenantSlug, finalUrl } after provisioning completes.
 * Throws if the signup fails or the provisioning panel shows an error.
 *
 * @param page     Playwright Page object (must be in a context with ignoreHTTPSErrors=true).
 * @param opts     Signup options.
 */
export async function signUpViaForm(
  page: Page,
  opts: SignUpOptions,
): Promise<SignUpResult> {
  const {
    slug,
    email,
    password,
    firstName = "E2E",
    lastName = "User",
    plan = "team",
    baseURL = DEFAULT_BASE_URL,
    provisioningTimeoutMs = 120_000,
  } = opts;

  // The workspace name must produce a slug that matches the `slug` parameter.
  // The tenant-operator slugifies the workspaceName: lowercase, spaces→hyphens,
  // collapse multiple hyphens. Using the slug directly as the workspace name
  // ensures the resulting Tenant CR name matches what the Go test expects.
  const workspaceName = slug;

  // -------------------------------------------------------------------------
  // 1. Navigate to signup form
  // -------------------------------------------------------------------------
  await page.goto(`${baseURL}/signup?plan=${plan}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });

  // Detect if already signed in (landed on dashboard)
  if (page.url().includes("/dashboard")) {
    console.log(
      `[signUpViaForm] Already on dashboard (${page.url()}), user may already exist`,
    );
    return { tenantSlug: slug, finalUrl: page.url() };
  }

  // -------------------------------------------------------------------------
  // 1b. Front-door shape detection (dashboard#961). Wait until the signup
  //     form is actually present, diagnosing the recognisable non-form
  //     shapes along the way. Verified against staging (SaaS profile,
  //     2026-07-04): /signup either renders the form directly, redirects to
  //     /login (login-only profile), or bounces off-host to the marketing
  //     pricing page (missing/invalid plan) — there is no gate-with-CTA
  //     shape for /signup, so no clicking happens here.
  // -------------------------------------------------------------------------
  const firstNameInput = page.getByLabel(/first name/i).first();
  const baseHost = new URL(baseURL).hostname;

  let formReady = false;
  const shapeDeadline = Date.now() + 15_000;
  while (Date.now() < shapeDeadline) {
    const current = new URL(page.url());
    if (current.pathname.startsWith("/login")) {
      throw new Error(
        `[signUpViaForm] /signup redirected to /login — this deployment ` +
          `profile has self-serve signup disabled (SIGNUP_SELF_SERVE unset). ` +
          `There is no signup path to drive. URL=${page.url()}`,
      );
    }
    if (current.hostname !== baseHost) {
      throw new Error(
        `[signUpViaForm] /signup?plan=${plan} bounced off-host to ` +
          `${page.url()} — the SaaS profile rejected the plan (marketing ` +
          `pricing redirect). Pass a valid self-serve plan id (e.g. "team").`,
      );
    }
    // Form shape: the first-name field is unique to the real form.
    if (await firstNameInput.isVisible().catch(() => false)) {
      formReady = true;
      break;
    }
    await page.waitForTimeout(250);
  }
  if (!formReady) {
    throw new Error(
      `[signUpViaForm] Timed out waiting for the signup form to render. ` +
        `URL=${page.url()}. Expected a "First name" field (kind + SaaS form), ` +
        `a redirect to /login (login-only profile), or an off-host pricing ` +
        `bounce.`,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Fill firstName
  // -------------------------------------------------------------------------
  await firstNameInput.fill(firstName);

  // -------------------------------------------------------------------------
  // 3. Fill lastName
  // -------------------------------------------------------------------------
  await page.getByLabel(/last name/i).fill(lastName);

  // -------------------------------------------------------------------------
  // 4. Fill email (label is "Work email")
  // -------------------------------------------------------------------------
  await page.getByLabel(/work email/i).fill(email);

  // -------------------------------------------------------------------------
  // 5. Fill password, first password input
  // -------------------------------------------------------------------------
  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.first().fill(password);

  // -------------------------------------------------------------------------
  // 6. Fill passwordConfirm, second password input (or by label)
  // -------------------------------------------------------------------------
  const pwCount = await pwInputs.count();
  if (pwCount >= 2) {
    await pwInputs.nth(1).fill(password);
  } else {
    // Form may hide confirm until password is filled; fallback to label
    await page.getByLabel(/confirm password/i).fill(password);
  }

  // -------------------------------------------------------------------------
  // 7. Fill workspaceName (label was "Workspace name", renamed to
  //    "Company Name" in dashboard#44 — match both)
  // -------------------------------------------------------------------------
  await page.getByLabel(/workspace name|company name/i).fill(workspaceName);

  // -------------------------------------------------------------------------
  // 8. Accept Terms of Service (id="acceptToS")
  // -------------------------------------------------------------------------
  await page.locator("#acceptToS").check();

  // -------------------------------------------------------------------------
  // 9. Accept Privacy Policy (id="acceptPrivacy")
  // -------------------------------------------------------------------------
  await page.locator("#acceptPrivacy").check();

  // -------------------------------------------------------------------------
  // 9b. Card-first SaaS profile (dashboard#784): when the deployment has paid
  //     tiers enabled, an inline Stripe Payment Element renders inside the
  //     form ("Payment method" label) and the submit button stays disabled
  //     until the card is complete. Detect it and drive the Stripe TEST card.
  //     On kind / self-hosted (billingEnabled=false) the label is absent and
  //     this block is a no-op — the card-free path is unchanged.
  // -------------------------------------------------------------------------
  const paymentLabel = page.getByText(/^payment method$/i).first();
  if (await paymentLabel.isVisible().catch(() => false)) {
    console.log(
      `[signUpViaForm] inline Payment Element detected (card-first profile), filling Stripe test card`,
    );
    // The Payment Element mounts asynchronously in Stripe.js iframes. The
    // accordion layout renders SEVERAL frames with the same title (an
    // accessory frame plus the actual input frame), so probe each candidate
    // for the card-number field instead of assuming a single match.
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
        `[signUpViaForm] Payment Element present but no card-number field ` +
          `found in any Stripe iframe within 30s. The card accordion may not ` +
          `be expanded, or the Stripe frame layout changed.`,
      );
    }

    await stripeFrame
      .getByPlaceholder(cardNumberPlaceholder)
      .fill("4242424242424242");
    await stripeFrame.getByPlaceholder(/mm ?\/ ?yy/i).fill("12 / 34");
    await stripeFrame.getByPlaceholder(/cvc/i).fill("123");
    // The billing-country combobox starts unselected; the element does not
    // report complete until it is chosen. Select US, which then reveals the
    // ZIP field — fill that too (completeness gates the submit button).
    const country = stripeFrame.getByLabel(/country/i).first();
    if (await country.isVisible().catch(() => false)) {
      await country
        .selectOption("US")
        .catch(() => country.selectOption({ label: "United States" }))
        .catch(() => undefined);
    }
    // The ZIP field is labelled ("ZIP") with no placeholder — match by label,
    // with a placeholder fallback for older element layouts.
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
  // 10. Submit the form. On the card-first profile the button only becomes
  //     enabled once Stripe reports the card complete; Playwright's click
  //     auto-waits for enabled, so give it a generous timeout.
  //
  //     The Stripe accordion keeps resizing for a moment after the card
  //     fields are filled, which shifts the submit button mid-click and the
  //     trusted click can land inside the (moving) Stripe iframe instead —
  //     observed deterministically against staging (dashboard#961). Scroll
  //     the button into view, let the layout settle, click, then VERIFY the
  //     submission actually started; fall back to a JS-dispatched click once
  //     if it did not.
  // -------------------------------------------------------------------------
  const submitButton = page
    .getByRole("button", { name: /create account/i })
    .first();
  await submitButton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1_000);
  await submitButton.click({ timeout: 30_000 });

  // Submission-started signals (positive only — a transiently disabled
  // button is NOT proof): the button flips to "Creating account…" /
  // "Setting up…", the ProvisioningPanel replaces the form, or the URL
  // leaves /signup. If none appear within 10s the click was swallowed —
  // dispatch a JS click (bypasses hit-target coordinates entirely).
  const submissionStarted = async (): Promise<boolean> => {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (!page.url().includes("/signup")) return true;
      const btnGone = (await submitButton.count().catch(() => 0)) === 0;
      if (btnGone) return true; // ProvisioningPanel replaced the form
      const btnText = (await submitButton.textContent().catch(() => "")) ?? "";
      if (/creating account|setting up/i.test(btnText)) return true;
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
      `[signUpViaForm] click did not start the submission, retrying with a JS-dispatched click (attempt ${attempt}/2)`,
    );
    await submitButton.dispatchEvent("click").catch(() => undefined);
    started = await submissionStarted();
  }
  if (!started) {
    throw new Error(
      `[signUpViaForm] "Create account" submission never started after a ` +
        `trusted click + 2 JS-dispatched clicks. URL=${page.url()}. ` +
        `Check for validation errors on the form or a card-completeness gate.`,
    );
  }

  // -------------------------------------------------------------------------
  // 11. Wait for the ProvisioningPanel to redirect.
  //
  //     The panel polls /api/signup/progress/:id. On terminalState=ok it
  //     calls window.location.assign to /login?callbackUrl=/dashboard.
  //     We wait for a URL change away from /signup.
  // -------------------------------------------------------------------------
  console.log(
    `[signUpViaForm] Waiting up to ${provisioningTimeoutMs}ms for provisioning to complete (slug=${slug})`,
  );

  // Poll for the terminal redirect, sniffing failure toasts along the way so
  // a server-side rejection (e.g. RATE_LIMITED from the per-IP signup
  // limiter) surfaces as its own message instead of a generic timeout.
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
        console.log(`[signUpViaForm] failure toast observed: ${bad}`);
      }
    }
    await page.waitForTimeout(1_000);
  }

  if (!redirected) {
    // Provisioning may have failed, check panel state
    const pageText = await page.textContent("body").catch(() => "");
    const currentUrl = page.url();

    if (/too many signup attempts/i.test(sawToast)) {
      throw new Error(
        `[signUpViaForm] Signup REJECTED for slug=${slug}: per-IP rate limit ` +
          `(toast: "${sawToast.slice(0, 160)}"). Concurrent signups from one ` +
          `host trip the in-memory limiter — serialise signups (run with ` +
          `--workers=1) or wait before retrying.`,
      );
    }
    if (sawToast) {
      throw new Error(
        `[signUpViaForm] Signup FAILED for slug=${slug}: server rejected the ` +
          `attempt (toast: "${sawToast.slice(0, 200)}"). URL=${currentUrl}.`,
      );
    }

    // Check for failure indicators in the panel
    const hasError =
      (pageText ?? "").toLowerCase().includes("support has been notified") ||
      (pageText ?? "").toLowerCase().includes("try again");

    if (hasError) {
      throw new Error(
        `[signUpViaForm] Provisioning FAILED for slug=${slug}. ` +
          `Panel showed error state. URL=${currentUrl}. ` +
          `Page text (first 500 chars): ${(pageText ?? "").slice(0, 500)}. ` +
          `Catalog hint: SIGNUP-B17/B18 (member role or acceptedByUserId issue), ` +
          `SIGNUP-B21 (Server Action ID rotation).`,
      );
    }

    throw new Error(
      `[signUpViaForm] Provisioning timed out for slug=${slug} after ${provisioningTimeoutMs}ms. ` +
        `URL=${currentUrl}. ` +
        `Page text (first 300 chars): ${(pageText ?? "").slice(0, 300)}.`,
    );
  }

  const finalUrl = page.url();

  // SIGNUP-B20 regression: post-signup redirect should NOT go to /api/auth/signin/zitadel
  if (finalUrl.includes("/api/auth/signin")) {
    throw new Error(
      `[signUpViaForm] SIGNUP-B20 REGRESSION: post-signup redirect went to ${finalUrl}. ` +
        `Expected /login?callbackUrl=/dashboard. ` +
        `Fix: ensure redirect is to /login?callbackUrl=/dashboard, not /api/auth/signin/zitadel.`,
    );
  }

  console.log(
    `[signUpViaForm] Signup PASSED for slug=${slug}. FinalURL=${finalUrl}`,
  );

  return { tenantSlug: slug, finalUrl };
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
