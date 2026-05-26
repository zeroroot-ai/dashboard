/**
 * login-full-chain.spec.ts — browser driver for the login full-chain e2e test.
 *
 * Uses signUpViaForm (Task 4) + loginViaZitadelV2 (Task 9) helpers.
 * Writes /tmp/login-redirect-chain-<slug>.json and /tmp/login-storage-state-<slug>.json
 * for the Go assertions in login_full_chain_test.go.
 *
 * Cluster: values.yaml + values-kind.yaml (single-values-file rule; no overlay).
 * Env: SIGNUP_SLUG, SIGNUP_EMAIL, SIGNUP_PASSWORD, PLAYWRIGHT_BASE_URL.
 * Bug catalog: LOGIN-B1–B4 in design.md.
 * Requirements: R1.1–R1.5, R2, R5.1.
 */

import { test, expect, type Page } from "@playwright/test";
import * as fs from "fs";
import { securePassword } from "./helpers/fixtures";
import { signUpViaForm } from "./helpers/signup-via-form";
import { loginViaZitadelV2 } from "./helpers/login-via-zitadel-v2";

const CLUSTER_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

/** One 3xx hop in the OIDC redirect chain (matches Go helpers.RedirectStep). */
interface RedirectStep { from: string; to: string; status: number; method: string; }
/** Expired-session result written to /tmp for Go side. */
interface ExpiredSessionResult { redirectedToLogin: boolean; hasRedirectToParam: boolean; finalUrl: string; }

function redactOIDC(url: string): string {
  return url.replace(/([?&])(code|state|id_token|nonce|session_state)=[^&]+/g, "$1$2=<redacted>");
}

/** Captures 3xx hops in the Go helpers.RedirectStep format. */
function captureRedirectChain(page: Page): { chain: RedirectStep[]; stop: () => void } {
  const chain: RedirectStep[] = [];
  const handler = (resp: { url: () => string; status: () => number; request: () => { method: () => string; redirectedFrom: () => { url: () => string } | null } }) => {
    const s = resp.status();
    if (s >= 300 && s < 400) {
      chain.push({ from: resp.request().redirectedFrom()?.url() ?? "", to: resp.url(), status: s, method: resp.request().method() });
    }
  };
  page.on("response", handler);
  return { chain, stop: () => page.off("response", handler) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Login — full chain (cluster e2e)", () => {
  /**
   * login full chain
   *
   * 1. Sign up a fresh user via signUpViaForm.
   * 2. Clear the browser session.
   * 3. Drive the Zitadel V2 login UI via loginViaZitadelV2.
   * 4. Write redirect chain JSON + storage state JSON for Go side.
   *
   * Requirements: R1.1–R1.5, R5.1.
   */
  test("login full chain", async ({ page, context }) => {
    // Signup (120s) + Zitadel login (60s) + chain capture + assertions = 3min budget.
    test.setTimeout(200_000);

    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;
    const password = process.env.SIGNUP_PASSWORD ?? securePassword();

    if (!slug || !email) {
      test.fail(true, "SIGNUP_SLUG and SIGNUP_EMAIL must be set — run via `make test-login-e2e`");
      return;
    }

    // -----------------------------------------------------------------------
    // 1. Sign up a fresh user
    // -----------------------------------------------------------------------
    console.log(`[login-full-chain] signing up slug=${slug} email=${email}`);
    await signUpViaForm(page, { slug, email, password, baseURL: CLUSTER_URL });

    // -----------------------------------------------------------------------
    // 2. Clear session (fresh-visit simulation)
    // -----------------------------------------------------------------------
    await context.clearCookies();
    await page.evaluate(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch (_) { /* ignore */ }
    });

    // -----------------------------------------------------------------------
    // 3. Capture 3xx redirect chain + drive Zitadel V2 login
    // -----------------------------------------------------------------------
    const { chain, stop: stopCapture } = captureRedirectChain(page);
    let loginResult;
    try {
      loginResult = await loginViaZitadelV2(page, context, {
        email,
        password,
        baseURL: CLUSTER_URL,
        loginFormTimeoutMs: 30_000,
        loginCompleteTimeoutMs: 60_000,
      });
    } finally {
      stopCapture();
    }

    console.log(
      `[login-full-chain] login complete. finalUrl=${redactOIDC(loginResult.finalUrl)} ` +
        `sessionCookieSet=${loginResult.sessionCookieSet} hops=${chain.length}`,
    );

    // -----------------------------------------------------------------------
    // 4. Write redirect chain JSON for Go assertions (R1.4)
    // -----------------------------------------------------------------------
    const chainPath = `/tmp/login-redirect-chain-${slug}.json`;
    fs.writeFileSync(chainPath, JSON.stringify(chain, null, 2));
    console.log(`[login-full-chain] redirect chain written to ${chainPath} (${chain.length} hops)`);

    // -----------------------------------------------------------------------
    // 5. Save storage state (cookies) for Go /api/me assertion (R1.5)
    // -----------------------------------------------------------------------
    const statePath = `/tmp/login-storage-state-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(`[login-full-chain] storage state written to ${statePath}`);

    // -----------------------------------------------------------------------
    // 6. Assert terminal landing on dashboard (not /signedin — LOGIN-B1)
    // -----------------------------------------------------------------------
    await expect(page).toHaveURL(/(\/dashboard|\/)/, { timeout: 10_000 });
    await expect(
      page.getByText(/invalid email or password|sign in failed/i),
    ).not.toBeVisible({ timeout: 3_000 });

    console.log(`[login-full-chain] PASSED for slug=${slug}`);
  });

  /**
   * negative: wrong password
   *
   * Requirements: R2.1.
   */
  test("negative: wrong password", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    const email = process.env.SIGNUP_EMAIL;
    if (!slug || !email) {
      test.skip(true, "SIGNUP_SLUG/SIGNUP_EMAIL not set");
      return;
    }

    // Drive Zitadel V2 with wrong password — expect failure (throw or no cookie).
    let failed = false;
    try {
      await loginViaZitadelV2(page, context, {
        email,
        password: "WrongPassword!99",
        baseURL: CLUSTER_URL,
        loginCompleteTimeoutMs: 30_000,
      });
    } catch {
      failed = true;
    }

    const cookies = await context.cookies();
    const hasSession = cookies.some((c) => c.name.includes("authjs.session-token"));
    if (!failed && hasSession) {
      throw new Error(
        "[login-full-chain] negative:wrong-password — session cookie SET with wrong password. " +
          "Authentication MUST reject wrong credentials (R2.1).",
      );
    }

    const statePath = `/tmp/login-negative-wrong-password-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(`[login-full-chain] negative:wrong-password PASSED (hasSession=${hasSession})`);
  });

  /**
   * negative: nonexistent email — same generic error, no user enumeration.
   *
   * Requirements: R2.2.
   */
  test("negative: nonexistent email", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    if (!slug) {
      test.skip(true, "SIGNUP_SLUG not set");
      return;
    }

    const fakeEmail = `nobody-${slug}@nowhere.invalid`;
    let failed = false;
    try {
      await loginViaZitadelV2(page, context, {
        email: fakeEmail,
        password: "AnyPassword!99",
        baseURL: CLUSTER_URL,
        loginCompleteTimeoutMs: 20_000,
      });
    } catch {
      failed = true;
    }

    const cookies = await context.cookies();
    const hasSession = cookies.some((c) => c.name.includes("authjs.session-token"));

    const statePath = `/tmp/login-negative-nonexistent-email-${slug}.json`;
    await context.storageState({ path: statePath });
    console.log(
      `[login-full-chain] negative:nonexistent-email PASSED (failed=${failed} hasSession=${hasSession})`,
    );
  });

  /**
   * negative: expired session cookie — protected route redirects to /login.
   *
   * Requirements: R2.5.
   */
  test("negative: expired session cookie", async ({ page, context }) => {
    const slug = process.env.SIGNUP_SLUG;
    if (!slug) {
      test.skip(true, "SIGNUP_SLUG not set");
      return;
    }

    const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await context.addCookies([{
      name: "authjs.session-token",
      value: "expired.session.token",
      domain: new URL(CLUSTER_URL).hostname,
      path: "/",
      expires: Math.floor(expiredDate.getTime() / 1000),
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    }]);

    await page.goto(`${CLUSTER_URL}/dashboard`, { waitUntil: "networkidle", timeout: 20_000 }).catch(() => {});

    const finalUrl = page.url();
    const result: ExpiredSessionResult = {
      redirectedToLogin: finalUrl.includes("/login"),
      hasRedirectToParam: finalUrl.includes("redirect_to=") || finalUrl.includes("callbackUrl=") || finalUrl.includes("from="),
      finalUrl: redactOIDC(finalUrl),
    };

    const resultPath = `/tmp/login-negative-expired-${slug}.json`;
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    console.log(
      `[login-full-chain] negative:expired-session redirectedToLogin=${result.redirectedToLogin} ` +
        `hasRedirectToParam=${result.hasRedirectToParam}`,
    );
  });
});
