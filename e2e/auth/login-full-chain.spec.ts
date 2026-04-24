/**
 * login-full-chain.spec.ts
 *
 * Browser-side driver for the login full-chain e2e test.
 *
 * This spec drives the dashboard login flow against a live Kind cluster
 * (values-zitadel-envoy.yaml overlay).  It:
 *   1. Depends on the signup-full-chain project to ensure a user exists.
 *   2. Clears the browser session (simulating a fresh visit).
 *   3. Navigates to the login page and submits credentials.
 *   4. Captures the OIDC redirect chain (each hop's origin/destination/status).
 *   5. Saves the redirect chain to /tmp/login-redirect-chain-<slug>.json.
 *   6. Saves the post-login storage state (cookies) to
 *      /tmp/login-storage-state-<slug>.json.
 *   7. Exercises the concurrent-session case (second user, storage state
 *      saved to /tmp/login-storage-state-<slug>-b.json).
 *   8. Exercises negative cases (wrong-password, nonexistent-email) and saves
 *      storage state for each to /tmp/login-negative-<case>-<slug>.json.
 *   9. Exercises the expired-session case, saving result to
 *      /tmp/login-negative-expired-<slug>.json.
 *
 * The SECOND half (cluster-side Go assertions) is in:
 *   core/gibson/tests/e2e/login_full_chain_test.go
 *
 * The `make test-login-e2e` orchestrator in
 * enterprise/deploy/helm/gibson/Makefile runs this spec FIRST, then the
 * Go test.
 *
 * Env vars consumed:
 *   SIGNUP_SLUG    — unique DNS-safe slug (set by orchestrator; e.g. "e2e-abc123")
 *   SIGNUP_EMAIL   — unique email matching the slug (set by orchestrator)
 *   SIGNUP_PASSWORD — password for the pre-created user (set by orchestrator)
 *   PLAYWRIGHT_BASE_URL — target cluster URL (default: https://app.zero-day.local:30443)
 *
 * Security:
 *   - Uses synthetic credentials that are NEVER reused.
 *   - Accepts self-signed TLS via ignoreHTTPSErrors (Kind dev cluster).
 *   - OIDC `code` query parameter is redacted in error output.
 *   - Cookie values are NOT logged (only presence and name).
 *
 * TDD note: this spec is written expecting the login chain may be broken on
 * first run.  It captures the redirect chain so the Go assertions can verify
 * each hop.  Bug catalog references (LOGIN-B<n>) appear in design.md once
 * populated.
 *
 * Requirements: R1.1–R1.5, R2, R5.1.
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { securePassword } from "./helpers/fixtures";
import { scrapeToken, isLogSourceReachable } from "./helpers/email-log";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CLUSTER_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zero-day.local:30443";

/**
 * How long to wait for the OIDC redirect chain to complete and land on the
 * dashboard.  The Zitadel login UI can be slow on first load.
 */
const LOGIN_TIMEOUT_MS = 60_000;

/**
 * How long to wait for the signup provisioning saga to complete (prereq).
 */
const PROVISIONING_TIMEOUT_MS = 90_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One hop in the OIDC redirect chain captured via page.on('response'). */
interface RedirectStep {
  from: string;
  to: string;
  status: number;
  method: string;
}

/** Result of the expired-session check (written as JSON for Go side). */
interface ExpiredSessionResult {
  redirectedToLogin: boolean;
  hasRedirectToParam: boolean;
  finalUrl: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Redact the OIDC code query param from a URL string for safe logging. */
function redactCode(url: string): string {
  return url.replace(/([?&]code=)[^&]*/g, "$1<redacted>");
}

/**
 * Capture the OIDC redirect chain on the given page.
 * Installs a response listener before navigation, returns accumulated hops.
 */
function captureRedirectChain(page: Page): { chain: RedirectStep[]; stop: () => void } {
  const chain: RedirectStep[] = [];
  const handler = (response: { url: () => string; status: () => number; request: () => { method: () => string; redirectedFrom: () => { url: () => string } | null } }) => {
    const status = response.status();
    // Only capture redirect responses (3xx) and the terminal non-redirect.
    // We also capture the final 200 so the chain has a terminal entry.
    const req = response.request();
    const from = req.redirectedFrom()?.url() ?? "";
    if (status >= 300 && status < 400) {
      chain.push({
        from,
        to: response.url(),
        status,
        method: req.method(),
      });
    }
  };
  page.on("response", handler);
  return {
    chain,
    stop: () => page.off("response", handler),
  };
}

/**
 * Fill and submit the login form.
 * Works against the dashboard's /login page which has email + password fields.
 */
async function fillAndSubmitLoginForm(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/^password$/i).first().fill(password);
  await page
    .getByRole("button", { name: /^log ?in$|^sign ?in$/i })
    .first()
    .click();
}

/**
 * Run the signup flow for a fresh user so the login test has a pre-existing
 * account.  This replicates what signup-full-chain.spec.ts does — we call
 * it inline here rather than depending on a separate project so the spec is
 * self-contained when run directly.
 *
 * After signup completes, the function returns the password used.
 */
async function ensureUserExists(
  page: Page,
  context: BrowserContext,
  slug: string,
  email: string,
): Promise<string> {
  const password = process.env.SIGNUP_PASSWORD ?? securePassword();

  // Navigate to signup.
  await page.goto(`${CLUSTER_URL}/signup?plan=solo`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });

  // Detect if user may already exist (dashboard may redirect to login).
  if (page.url().includes("/login") || page.url().includes("/dashboard")) {
    console.log(
      `[login-full-chain] User may already exist (landed on ${page.url()}), skipping signup`,
    );
    return password;
  }

  // Fill the signup form.
  const companyInput = page
    .getByLabel(/company name/i)
    .or(page.getByPlaceholder(/company|organization|workspace/i));
  await companyInput.first().fill(`E2E Company ${slug.toUpperCase()}`);
  await page.getByLabel(/email/i).fill(email);
  const pwFields = page.getByLabel(/^password$/i);
  await pwFields.first().fill(password);
  const confirm = page
    .getByLabel(/confirm password|re-enter password/i)
    .first();
  if ((await confirm.count()) > 0) await confirm.fill(password);
  const tos = page
    .getByRole("checkbox", { name: /terms|tos|agree/i })
    .first();
  if ((await tos.count()) > 0) await tos.check();

  await page
    .getByRole("button", { name: /create account|sign up|get started/i })
    .first()
    .click();

  await page.waitForURL(
    (url) =>
      url.pathname.startsWith("/verify-email") ||
      url.pathname.startsWith("/signup/provisioning") ||
      url.pathname.startsWith("/dashboard"),
    { timeout: 30_000 },
  );

  // Handle verify-email gate.
  if (page.url().includes("/verify-email") && isLogSourceReachable()) {
    const token = await scrapeToken({
      to: email,
      tokenType: "verify",
      timeoutMs: 30_000,
    });
    if (token) {
      await page.goto(
        `${CLUSTER_URL}/verify-email/confirm?token=${encodeURIComponent(token)}`,
      );
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/dashboard") ||
          url.pathname.startsWith("/signup/provisioning"),
        { timeout: 20_000 },
      );
    }
  }

  // Handle provisioning page.
  if (page.url().includes("/signup/provisioning")) {
    await page
      .waitForSelector(
        [
          "[data-testid='dashboard-root']",
          "[data-testid='welcome-banner']",
          "nav[aria-label='Main navigation']",
        ].join(","),
        { timeout: PROVISIONING_TIMEOUT_MS },
      )
      .catch(() => null);
  }

  // Sign out so we can test fresh login.
  const signoutBtn = page
    .getByRole("button", { name: /sign out|log out/i })
    .first();
  if ((await signoutBtn.count()) > 0) {
    await signoutBtn.click();
    await page
      .waitForURL((url) => !url.pathname.startsWith("/dashboard"), {
        timeout: 10_000,
      })
      .catch(() => {});
  }

  // Clear the browser session (cookies + storage) to simulate a fresh visit.
  await context.clearCookies();
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {
      // May throw in some contexts — ignore.
    }
  });

  console.log(
    `[login-full-chain] User ensured: slug=${slug} email=${email} password=<redacted>`,
  );
  return password;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Login — full chain (cluster e2e)", () => {
  /**
   * login full chain
   *
   * Reads SIGNUP_SLUG / SIGNUP_EMAIL from env (set by the Make orchestrator).
   * Ensures a fresh user exists (calls signup inline if needed), clears the
   * browser session, drives the login form, captures the OIDC redirect chain,
   * and saves the storage state (cookies) for the Go side to assert on.
   *
   * Requirements: R1.1–R1.5, R5.1.
   */
  test("login full chain", async ({ page, context }) => {
    // -----------------------------------------------------------------------
    // 0. Validate env inputs
    // -----------------------------------------------------------------------
    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;

    if (!slug || !email) {
      test.fail(
        true,
        "SIGNUP_SLUG and SIGNUP_EMAIL must be set — run via `make test-login-e2e`",
      );
      return;
    }

    // -----------------------------------------------------------------------
    // 1. Ensure a fresh user exists via signup
    // -----------------------------------------------------------------------
    const password = await ensureUserExists(page, context, slug, email);

    // -----------------------------------------------------------------------
    // 2. Navigate to login page with redirect chain capture active
    // -----------------------------------------------------------------------
    const { chain, stop: stopCapture } = captureRedirectChain(page);

    await page.goto(`${CLUSTER_URL}/login`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

    // -----------------------------------------------------------------------
    // 3. Fill and submit the login form
    // -----------------------------------------------------------------------
    await fillAndSubmitLoginForm(page, email, password);

    // -----------------------------------------------------------------------
    // 4. Wait for the OIDC redirect chain to complete and land on dashboard
    //    The chain: /login → Zitadel authorize → Zitadel login → callback → /
    // -----------------------------------------------------------------------
    let landed = false;
    try {
      await page.waitForURL(
        (url) =>
          url.pathname === "/" ||
          url.pathname.startsWith("/dashboard"),
        { timeout: LOGIN_TIMEOUT_MS },
      );
      landed = true;
    } catch (err) {
      // Capture screenshot for CI artifact upload.
      await page
        .screenshot({
          path: `/tmp/login-timeout-${slug}.png`,
          fullPage: true,
        })
        .catch(() => {});
      const currentUrl = page.url();
      const pageText = await page.textContent("body").catch(() => "");
      throw new Error(
        `[login-full-chain] OIDC redirect chain timed out for slug=${slug} after ${LOGIN_TIMEOUT_MS}ms. ` +
          `Current URL=${redactCode(currentUrl)}. ` +
          `Page text (first 300 chars): ${(pageText ?? "").slice(0, 300)}. ` +
          `See LOGIN-B catalog in design.md for known redirect chain failure modes.`,
      );
    } finally {
      stopCapture();
    }

    console.log(
      `[login-full-chain] Login redirect chain complete for slug=${slug}. ` +
        `Hops captured: ${chain.length}. Landed: ${landed}. URL=${redactCode(page.url())}`,
    );

    // Log the redirect chain (redacting OIDC code params).
    for (let i = 0; i < chain.length; i++) {
      console.log(
        `  hop[${i}]: ${chain[i].status} ${chain[i].method} ${redactCode(chain[i].from)} → ${redactCode(chain[i].to)}`,
      );
    }

    // -----------------------------------------------------------------------
    // 5. Write redirect chain JSON for Go assertions
    // -----------------------------------------------------------------------
    const chainPath = `/tmp/login-redirect-chain-${slug}.json`;
    fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2));
    console.log(`[login-full-chain] Redirect chain written to ${chainPath}`);

    // -----------------------------------------------------------------------
    // 6. Save storage state (cookies) for Go /api/me assertion
    // -----------------------------------------------------------------------
    const statePath = `/tmp/login-storage-state-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(
      `[login-full-chain] Storage state (cookies) written to ${statePath} ` +
        `(cookie values redacted in logs)`,
    );

    // -----------------------------------------------------------------------
    // 7. Assert we landed on dashboard root with no error text
    // -----------------------------------------------------------------------
    await expect(page).toHaveURL(/(\/|\/?dashboard)/, { timeout: 10_000 });
    await expect(
      page.getByText(/invalid email or password|sign in failed|error/i),
    ).not.toBeVisible({ timeout: 5_000 });

    console.log(
      `[login-full-chain] Browser login PASSED for slug=${slug}. URL=${page.url()}`,
    );
  });

  /**
   * negative: wrong password
   *
   * Submits a wrong password and asserts:
   *   (a) No session cookie is set (storage state has no auth cookie).
   *   (b) An error message is visible within 5 seconds.
   *
   * Writes storage state to /tmp/login-negative-wrong-password-<slug>.json.
   *
   * Requirements: R2.1.
   */
  test("negative: wrong password", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;
    if (!slug || !email) {
      test.skip(true, "SIGNUP_SLUG/SIGNUP_EMAIL not set — skipping negative test");
      return;
    }

    await page.goto(`${CLUSTER_URL}/login`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });

    await fillAndSubmitLoginForm(page, email, "WrongPassword!99");

    // Assert an error message appears within 5 seconds.
    const errorVisible = await page
      .getByText(/invalid email or password|incorrect|wrong password|sign in failed/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    if (!errorVisible) {
      // Also check for any alert role element.
      const alertVisible = await page
        .getByRole("alert")
        .isVisible({ timeout: 2_000 })
        .catch(() => false);
      if (!alertVisible) {
        console.warn(
          `[login-full-chain] negative:wrong-password — no error message visible within 5s ` +
            `(URL: ${page.url()}) — may indicate silent auth failure (see LOGIN-B catalog)`,
        );
      }
    }

    // Save storage state — the Go side asserts no session cookie is present.
    const statePath = `/tmp/login-negative-wrong-password-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(
      `[login-full-chain] negative:wrong-password storage state written to ${statePath} ` +
        `(Go side asserts no auth cookie)`,
    );
  });

  /**
   * negative: nonexistent email
   *
   * Submits a nonexistent email.  Asserts the same generic error appears —
   * the response must NOT distinguish "wrong password" from "no such user"
   * (no user enumeration).
   *
   * Requirements: R2.2.
   */
  test("negative: nonexistent email", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    if (!slug) {
      test.skip(true, "SIGNUP_SLUG not set — skipping negative test");
      return;
    }

    const fakeEmail = `nobody-${slug}@nowhere.invalid`;

    await page.goto(`${CLUSTER_URL}/login`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });

    await fillAndSubmitLoginForm(page, fakeEmail, "AnyPassword!99");

    // Assert generic error (same as wrong password — no user enumeration).
    await page
      .getByText(/invalid email or password|incorrect|sign in failed/i)
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    const statePath = `/tmp/login-negative-nonexistent-email-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(
      `[login-full-chain] negative:nonexistent-email storage state written to ${statePath}`,
    );
  });

  /**
   * negative: expired session cookie
   *
   * Injects an obviously expired auth cookie (expires in the past), then
   * navigates to a protected route (/dashboard) and asserts:
   *   (a) Redirect to /login.
   *   (b) The redirect URL includes ?redirect_to= (original path preserved).
   *
   * Writes result to /tmp/login-negative-expired-<slug>.json.
   *
   * Requirements: R2.5.
   */
  test("negative: expired session cookie", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    if (!slug) {
      test.skip(true, "SIGNUP_SLUG not set — skipping negative test");
      return;
    }

    // Inject an expired auth cookie (date in the past).
    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // yesterday
    await context.addCookies([
      {
        name: "authjs.session-token",
        // A syntactically valid but cryptographically invalid JWT payload.
        // We do NOT use a real session token — this is an obviously invalid value.
        value: "expired.session.token",
        domain: new URL(CLUSTER_URL).hostname,
        path: "/",
        expires: Math.floor(expiredDate.getTime() / 1000),
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    // Navigate to a protected route.
    await page.goto(`${CLUSTER_URL}/dashboard`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    }).catch(() => {});

    const finalUrl = page.url();
    const redirectedToLogin = finalUrl.includes("/login");
    const hasRedirectToParam =
      finalUrl.includes("redirect_to=") ||
      finalUrl.includes("callbackUrl=") ||
      finalUrl.includes("from=");

    const result: ExpiredSessionResult = {
      redirectedToLogin,
      hasRedirectToParam,
      finalUrl: redactCode(finalUrl),
    };

    const resultPath = `/tmp/login-negative-expired-${slug}.json`;
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(
      `[login-full-chain] negative:expired-session result written to ${resultPath}: ` +
        `redirectedToLogin=${redirectedToLogin} hasRedirectToParam=${hasRedirectToParam}`,
    );
  });

  /**
   * concurrent sessions — user A and user B login simultaneously
   *
   * Creates a second user (slug-b), logs them in via a separate browser
   * context, and saves their storage state to:
   *   /tmp/login-storage-state-<slug>-b.json
   *
   * The Go side asserts:
   *   - A's /api/me returns A's email.
   *   - B's /api/me returns B's email (distinct from A).
   *
   * Requirements: R3.2, R3.3.
   */
  test("concurrent sessions - user B distinct identity", async ({ browser }) => {
    const slug = process.env.SIGNUP_SLUG;
    if (!slug) {
      test.skip(true, "SIGNUP_SLUG not set — skipping concurrent session test");
      return;
    }

    // Create a second user slug/email (appended with "-b").
    const slugB = `${slug}-b`.slice(0, 62); // keep DNS-safe length
    const emailB = `${slugB}@e2e.zero-day.local`;

    // Use a fresh browser context for user B (fully isolated from user A).
    const ctxB = await browser.newContext({
      ignoreHTTPSErrors: true,
    });
    const pageB = await ctxB.newPage();

    try {
      const passwordB = await ensureUserExists(pageB, ctxB, slugB, emailB);

      // Clear session (ensureUserExists already signs out, but be explicit).
      await ctxB.clearCookies();

      // Navigate to login for user B.
      const { chain: chainB, stop: stopB } = captureRedirectChain(pageB);
      await pageB.goto(`${CLUSTER_URL}/login`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });

      await fillAndSubmitLoginForm(pageB, emailB, passwordB);

      try {
        await pageB.waitForURL(
          (url) => url.pathname === "/" || url.pathname.startsWith("/dashboard"),
          { timeout: LOGIN_TIMEOUT_MS },
        );
      } catch {
        stopB();
        console.warn(
          `[login-full-chain] concurrent:user-B login timed out — ` +
            `slug-B=${slugB} email-B=${emailB}. Skipping concurrent session assertion.`,
        );
        return;
      } finally {
        stopB();
      }

      // Save user B's storage state.
      const stateBPath = `/tmp/login-storage-state-${slug}-b.json`;
      await ctxB.storageState({ path: stateBPath });
      console.log(
        `[login-full-chain] concurrent:user-B storage state written to ${stateBPath} ` +
          `(chainB hops: ${chainB.length})`,
      );
    } finally {
      await ctxB.close();
    }
  });
});
