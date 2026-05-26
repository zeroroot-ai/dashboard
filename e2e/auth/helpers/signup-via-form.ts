/**
 * signup-via-form.ts — canonical helper that drives the real Gibson signup form.
 *
 * ONE function — no per-spec `ensureUserExists` reimplementations. All four
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
  /** Plan to select (default: "solo"). */
  plan?: "solo" | "squad" | "enterprise";
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
 * signUpViaForm — drives the Gibson signup form against the live cluster.
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
    plan = "solo",
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
      `[signUpViaForm] Already on dashboard (${page.url()}) — user may already exist`,
    );
    return { tenantSlug: slug, finalUrl: page.url() };
  }

  // -------------------------------------------------------------------------
  // 2. Fill firstName
  // -------------------------------------------------------------------------
  await page.getByLabel(/first name/i).fill(firstName);

  // -------------------------------------------------------------------------
  // 3. Fill lastName
  // -------------------------------------------------------------------------
  await page.getByLabel(/last name/i).fill(lastName);

  // -------------------------------------------------------------------------
  // 4. Fill email (label is "Work email")
  // -------------------------------------------------------------------------
  await page.getByLabel(/work email/i).fill(email);

  // -------------------------------------------------------------------------
  // 5. Fill password — first password input
  // -------------------------------------------------------------------------
  const pwInputs = page.locator('input[type="password"]');
  await pwInputs.first().fill(password);

  // -------------------------------------------------------------------------
  // 6. Fill passwordConfirm — second password input (or by label)
  // -------------------------------------------------------------------------
  const pwCount = await pwInputs.count();
  if (pwCount >= 2) {
    await pwInputs.nth(1).fill(password);
  } else {
    // Form may hide confirm until password is filled; fallback to label
    await page.getByLabel(/confirm password/i).fill(password);
  }

  // -------------------------------------------------------------------------
  // 7. Fill workspaceName (label is "Workspace name")
  // -------------------------------------------------------------------------
  await page.getByLabel(/workspace name/i).fill(workspaceName);

  // -------------------------------------------------------------------------
  // 8. Accept Terms of Service (id="acceptToS")
  // -------------------------------------------------------------------------
  await page.locator("#acceptToS").check();

  // -------------------------------------------------------------------------
  // 9. Accept Privacy Policy (id="acceptPrivacy")
  // -------------------------------------------------------------------------
  await page.locator("#acceptPrivacy").check();

  // -------------------------------------------------------------------------
  // 10. Submit the form
  // -------------------------------------------------------------------------
  await page.getByRole("button", { name: /create account/i }).click();

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

  try {
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/login") ||
        url.pathname.startsWith("/dashboard"),
      { timeout: provisioningTimeoutMs },
    );
  } catch {
    // Provisioning may have failed — check panel state
    const pageText = await page.textContent("body").catch(() => "");
    const currentUrl = page.url();

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
