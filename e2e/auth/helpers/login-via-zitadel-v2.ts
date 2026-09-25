// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * login-via-zitadel-v2.ts, canonical helper that drives the Zitadel V2 login UI.
 *
 * ONE function, no per-spec Zitadel selector reimplementations. All login
 * spec files import this instead of inline Zitadel UI logic.
 *
 * The Zitadel V2 login UI flow (source of truth: login-trace.spec.ts, commit 659678e):
 *   1. Navigate to /login (dashboard's LoginForm fires signIn("zitadel"))
 *   2. Wait for Zitadel V2 loginname form at /ui/v2/login/loginname
 *   3. Fill loginname (email) and submit
 *   4. Wait for Zitadel V2 password form at /ui/v2/login/password
 *   5. Fill password and submit
 *   6. Wait for terminal landing (dashboard callback or /dashboard)
 *
 * Front-door shapes (dashboard#961): /login renders differently per deployment
 * profile, so step 1 is shape-aware:
 *   (a) auto-handoff — the page fires signIn("zitadel") on load and the
 *       browser leaves /login on its own (legacy kind behavior). Nothing to do.
 *   (b) gate page (SaaS profile, deploy#1060) — "Welcome to Gibson" card with
 *       a "Sign in" button and ZERO inputs. We click the button, which hands
 *       off to the Zitadel V2 loginname page, then steps 2-5 run unchanged.
 *   (c) inline email/password form — filled and submitted directly on /login;
 *       the Zitadel V2 pages (steps 2-5) are skipped entirely.
 *
 * Bug catalog:
 *   LOGIN-B1: useEffect double-fire causes duplicate signin/zitadel POSTs.
 *             Symptom: browser parks on /ui/v2/login/signedin. Fixed: commit 5dfa778.
 *   LOGIN-B2: JWT tenant claim absent. Symptom: callback lands then redirects to
 *             /federated-signout. Fixed: K8s fallback in auth.ts, commit 659678e.
 *
 * Security:
 *   - Passwords are never logged (only presence is confirmed).
 *   - Cookie values are never logged.
 *
 * Requirements: R3.3.
 */

import { type Page, type BrowserContext } from "@playwright/test";
import { computeTotp, getTotpSecret, rememberTotpSecret } from "./totp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginOptions {
  /** Email address (Zitadel loginname). */
  email: string;
  /** Password for Zitadel. Must match Zitadel password policy. */
  password: string;
  /** Base URL of the cluster (default: PLAYWRIGHT_BASE_URL env or https://app.zeroroot.local:30443). */
  baseURL?: string;
  /** Milliseconds to wait for Zitadel loginname form to appear (default: 30_000). */
  loginFormTimeoutMs?: number;
  /** Milliseconds to wait for the terminal landing after password submit (default: 60_000). */
  loginCompleteTimeoutMs?: number;
  /**
   * Milliseconds to spend detecting the /login front-door shape
   * (auto-handoff vs gate page vs inline form). Default: 15_000.
   */
  shapeDetectTimeoutMs?: number;
}

/** One hop captured during the OIDC redirect chain. */
export interface LoginHop {
  ts: string;
  status: number;
  method: string;
  url: string;
}

export interface LoginResult {
  /** Final URL after the OIDC flow completes. */
  finalUrl: string;
  /** OIDC redirect chain captured via page.on('response'). */
  chain: LoginHop[];
  /** Whether an authjs session cookie is present after login. */
  sessionCookieSet: boolean;
}

// ---------------------------------------------------------------------------
// MFA (hosted#193 D3, plan-193 section 3.6)
// ---------------------------------------------------------------------------

/**
 * Handles Zitadel V2's post-password MFA step, when `forceMfa` presents
 * one. No-ops (returns immediately) when neither MFA URL appears within
 * `detectTimeoutMs` — the normal case while `forceMfa` is off.
 *
 * TWO shapes, matching the plan:
 *   - `/ui/v2/login/mfa/set` (first-factor enrollment): this test user was
 *     just created and has no factor yet. Choose "Authenticator app",
 *     read the TOTP secret the page displays, compute a code, submit.
 *   - `/ui/v2/login/otp/time-based` (an already-registered factor):
 *     compute a code from a secret remembered earlier in this process
 *     (`getTotpSecret`) and submit it.
 *
 * // TODO(hosted#193): the selectors below (the "Authenticator app" choice,
 * // the manual-entry secret text, and the code input on the enrollment
 * // page) are written from this file's existing patterns (role/label-based,
 * // tolerant regexes) but are NOT verified against a live Zitadel v2 login
 * // app — I do not have a running cluster to inspect the actual DOM. If
 * // `forceMfa` lands before this is checked against a real instance, run
 * // one login through it headed (`PWDEBUG=1` or `--headed`) and correct any
 * // selector that does not match, in particular how the secret is exposed
 * // (a "can't scan the code" / "enter manually" toggle is common in
 * // Zitadel's own screenshots, but the exact copy was not verified here).
 */
async function handleMfaIfPresented(page: Page, email: string): Promise<void> {
  const detectTimeoutMs = 15_000;
  const deadline = Date.now() + detectTimeoutMs;
  let shape: "set" | "otp" | "none" = "none";
  while (Date.now() < deadline) {
    const path = new URL(page.url()).pathname;
    if (path.includes("/ui/v2/login/mfa/set")) {
      shape = "set";
      break;
    }
    if (path.includes("/ui/v2/login/otp/time-based")) {
      shape = "otp";
      break;
    }
    // Already past both MFA steps (forceMfa is off, or a passkey/other
    // factor completed sign-in without a code prompt): nothing to do.
    if (
      path.startsWith("/api/auth/callback/zitadel") ||
      path.startsWith("/dashboard") ||
      path === "/"
    ) {
      return;
    }
    await page.waitForTimeout(250);
  }
  if (shape === "none") return;

  if (shape === "set") {
    console.log(`[loginViaZitadelV2] MFA enrollment required, choosing authenticator app`);
    await page
      .getByRole("button", { name: /authenticator app/i })
      .or(page.getByRole("link", { name: /authenticator app/i }))
      .or(page.getByText(/authenticator app/i))
      .first()
      .click();

    // Zitadel shows a QR code plus a manually-enterable base32 secret. Try
    // a "can't scan" / "enter manually" toggle first (common in Zitadel's
    // own docs); fall back to reading a base32-shaped string directly off
    // the page if the toggle isn't present.
    const manualToggle = page.getByRole("button", { name: /manually|can.?t scan/i });
    if (await manualToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await manualToggle.click();
    }
    const secretLocator = page.getByText(/^[A-Z2-7]{16,32}$/);
    await secretLocator.first().waitFor({ timeout: 10_000 });
    const secret = (await secretLocator.first().textContent())?.trim().replace(/\s+/g, "");
    if (!secret) {
      throw new Error(
        "[loginViaZitadelV2] MFA enrollment: could not read the TOTP secret from the page. " +
          "See the TODO(hosted#193) comment on handleMfaIfPresented: this selector is unverified.",
      );
    }
    rememberTotpSecret(email, secret);

    const code = computeTotp(secret);
    console.log(`[loginViaZitadelV2] submitting TOTP enrollment code`);
    await page.getByLabel(/code/i).first().fill(code);
    await page
      .getByRole("button", { name: /next|continue|submit|verify/i })
      .first()
      .click();
    return;
  }

  // shape === "otp": an already-registered factor, compute a fresh code.
  const secret = getTotpSecret(email);
  if (!secret) {
    throw new Error(
      `[loginViaZitadelV2] Zitadel asked for a TOTP code for ${email}, but no secret was ` +
        "remembered for this process. This can only happen if the user was enrolled outside " +
        "this helper (e.g. a previous test run against a persistent user).",
    );
  }
  const code = computeTotp(secret);
  console.log(`[loginViaZitadelV2] submitting TOTP code`);
  await page.getByLabel(/code/i).first().fill(code);
  await page
    .getByRole("button", { name: /next|continue|submit|verify/i })
    .first()
    .click();
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

/** Redact OIDC code/state/id_token from a URL for safe logging. */
function redactOIDCParams(url: string): string {
  return url.replace(
    /([?&])(code|state|id_token|nonce|session_state)=[^&]+/g,
    "$1$2=<redacted>",
  );
}

/**
 * loginViaZitadelV2, drives the Zitadel V2 OIDC login UI against the live cluster.
 *
 * Returns the resolved { finalUrl, chain, sessionCookieSet } after the OIDC
 * flow completes (success or parked-at-signedin failure).
 * Throws if the flow cannot reach the Zitadel login UI or times out.
 *
 * @param page     Playwright Page (must be in a context with ignoreHTTPSErrors=true).
 * @param context  Playwright BrowserContext (for cookie inspection).
 * @param opts     Login options.
 */
export async function loginViaZitadelV2(
  page: Page,
  context: BrowserContext,
  opts: LoginOptions,
): Promise<LoginResult> {
  const {
    email,
    password,
    baseURL = DEFAULT_BASE_URL,
    loginFormTimeoutMs = 30_000,
    loginCompleteTimeoutMs = 60_000,
    shapeDetectTimeoutMs = 15_000,
  } = opts;

  const chain: LoginHop[] = [];
  page.on("response", (resp) => {
    chain.push({
      ts: new Date().toISOString(),
      status: resp.status(),
      method: resp.request().method(),
      url: redactOIDCParams(resp.url()),
    });
  });

  // -------------------------------------------------------------------------
  // 1. Navigate to /login.
  //    LoginForm's useEffect fires signIn("zitadel", …) which POSTs to
  //    /api/auth/signin/zitadel and 302s to Zitadel.
  // -------------------------------------------------------------------------
  console.log(`[loginViaZitadelV2] navigating to ${baseURL}/login`);
  await page.goto(`${baseURL}/login`, { waitUntil: "load", timeout: loginFormTimeoutMs });

  // If already on dashboard (previous session still valid), return early.
  if (page.url().includes("/dashboard")) {
    console.log(`[loginViaZitadelV2] Already authenticated, landed on ${page.url()}`);
    const cookies = await context.cookies();
    return {
      finalUrl: page.url(),
      chain,
      sessionCookieSet: cookies.some((c) =>
        c.name.includes("authjs.session-token"),
      ),
    };
  }

  // -------------------------------------------------------------------------
  // 1b. Front-door shape detection (dashboard#961).
  //     If we are still on /login, work out which shape rendered:
  //       - inline: email + password inputs directly on /login (kind inline
  //         form). Fill and submit here; the Zitadel V2 steps are skipped.
  //       - gate: zero inputs, a "Sign in" button (SaaS profile,
  //         deploy#1060). Click it to hand off to Zitadel V2.
  //       - handoff: the page already left /login on its own (legacy
  //         auto-fire). Fall through to the V2 wait unchanged.
  // -------------------------------------------------------------------------
  let inlineLoginDone = false;
  if (new URL(page.url()).pathname.startsWith("/login")) {
    const emailInput = page.getByLabel(/email/i).first();
    const passwordInput = page.locator('input[type="password"]').first();
    const gateButton = page
      .getByRole("button", { name: /^sign ?in\b/i })
      .first();

    type FrontDoorShape = "handoff" | "inline" | "gate" | "unknown";
    let shape: FrontDoorShape = "unknown";
    const shapeDeadline = Date.now() + shapeDetectTimeoutMs;
    while (Date.now() < shapeDeadline) {
      if (!new URL(page.url()).pathname.startsWith("/login")) {
        shape = "handoff";
        break;
      }
      // Check for the inline form FIRST: the inline shape also has a submit
      // button that matches the gate-button name pattern.
      if (
        (await emailInput.isVisible().catch(() => false)) &&
        (await passwordInput.isVisible().catch(() => false))
      ) {
        shape = "inline";
        break;
      }
      if (await gateButton.isVisible().catch(() => false)) {
        shape = "gate";
        break;
      }
      await page.waitForTimeout(250);
    }
    console.log(`[loginViaZitadelV2] /login front-door shape: ${shape}`);

    if (shape === "inline") {
      // Kind inline-form path, unchanged behavior: credentials are submitted
      // directly on /login, no Zitadel V2 pages are involved.
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page
        .getByRole("button", { name: /^log ?in$|^sign ?in$/i })
        .first()
        .click();
      inlineLoginDone = true;
    } else if (shape === "gate") {
      // SaaS gate page: click "Sign in" to initiate the Zitadel OIDC flow.
      await gateButton.click();
      // Hydration guard: if the click landed before React attached the
      // onClick handler, the URL never changes. Retry once.
      const left = await page
        .waitForURL((url) => !url.pathname.startsWith("/login"), {
          timeout: 10_000,
        })
        .then(() => true)
        .catch(() => false);
      if (!left) {
        console.log(
          `[loginViaZitadelV2] gate Sign-in click was a no-op (pre-hydration?), retrying once`,
        );
        await gateButton.click().catch(() => undefined);
      }
    }
    // shape === "handoff" | "unknown": fall through, step 2's wait either
    // succeeds (auto-fire happened) or produces the existing rich error.
  }

  if (!inlineLoginDone) {
    // -----------------------------------------------------------------------
    // 2. Wait for Zitadel V2 loginname form.
    //    LOGIN-B1: if /login triggered two POSTs to signin/zitadel, Zitadel
    //    will park the browser on /signedin instead of /loginname.
    // -----------------------------------------------------------------------
    console.log(`[loginViaZitadelV2] waiting for Zitadel V2 loginname form`);
    try {
      await page.waitForURL(/\/ui\/v2\/login\/loginname/, {
        timeout: loginFormTimeoutMs,
      });
    } catch {
      const currentUrl = page.url();
      if (currentUrl.includes("/ui/v2/login/signedin")) {
        throw new Error(
          `[loginViaZitadelV2] LOGIN-B1 REGRESSION: Zitadel parked browser on /signedin. ` +
            `This is the useEffect double-fire bug (commit 5dfa778). ` +
            `Check login-form.tsx for a useRef guard. URL=${currentUrl}`,
        );
      }
      throw new Error(
        `[loginViaZitadelV2] Timed out waiting for Zitadel V2 loginname form. ` +
          `Current URL=${currentUrl}. ` +
          `Ensure the /login front door handed off to Zitadel (gate "Sign in" ` +
          `clicked, or signIn("zitadel") fired on page load).`,
      );
    }

    // -----------------------------------------------------------------------
    // 3. Fill loginname (email) and submit.
    // -----------------------------------------------------------------------
    console.log(`[loginViaZitadelV2] filling loginname`);
    await page.getByLabel(/login.?name|email|user/i).first().fill(email);
    await page.getByRole("button", { name: /next|continue|submit/i }).first().click();

    // -----------------------------------------------------------------------
    // 4. Wait for Zitadel V2 password form.
    // -----------------------------------------------------------------------
    console.log(`[loginViaZitadelV2] waiting for Zitadel V2 password form`);
    try {
      await page.waitForURL(/\/ui\/v2\/login\/password/, { timeout: 20_000 });
    } catch {
      const currentUrl = page.url();
      throw new Error(
        `[loginViaZitadelV2] Timed out waiting for Zitadel V2 password form. ` +
          `Current URL=${currentUrl}. ` +
          `Check: loginname submitted correctly, user exists in Zitadel org.`,
      );
    }

    // -----------------------------------------------------------------------
    // 5. Fill password and submit.
    // -----------------------------------------------------------------------
    console.log(`[loginViaZitadelV2] filling password`);
    await page.locator('input[type="password"]').first().fill(password);
    await page
      .getByRole("button", { name: /next|continue|submit|sign.?in/i })
      .first()
      .click();

    // -----------------------------------------------------------------------
    // 5b. MFA (hosted#193 D3, plan-193 section 3.6): once `forceMfa` is
    //     enforced, a user with only a password lands on
    //     `/ui/v2/login/mfa/set?force=true` right after the password step
    //     (first-factor enrollment — this test user was just created and
    //     has no factor yet), or on `/ui/v2/login/otp/time-based` if a
    //     factor from an earlier run in this process is already known
    //     (see `getTotpSecret`). Skipped entirely when `forceMfa` is off:
    //     the wait below falls through to the terminal-landing wait in
    //     step 6 without matching either MFA URL.
    // -----------------------------------------------------------------------
    await handleMfaIfPresented(page, email);
  }

  // -------------------------------------------------------------------------
  // 6. Wait for terminal landing.
  //    Success: /api/auth/callback/zitadel then /dashboard
  //    Failure (LOGIN-B1): /ui/v2/login/signedin
  // -------------------------------------------------------------------------
  console.log(`[loginViaZitadelV2] waiting for terminal landing (timeout=${loginCompleteTimeoutMs}ms)`);
  try {
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/api/auth/callback/zitadel") ||
        url.pathname.startsWith("/dashboard") ||
        url.pathname === "/" ||
        url.pathname.includes("/ui/v2/login/signedin"),
      { timeout: loginCompleteTimeoutMs },
    );
  } catch {
    console.log(
      `[loginViaZitadelV2] terminal wait timed out, current URL=${page.url()}`,
    );
  }

  const finalUrl = page.url();
  console.log(`[loginViaZitadelV2] final URL: ${redactOIDCParams(finalUrl)}`);

  // -------------------------------------------------------------------------
  // 7. Check for session cookie.
  // -------------------------------------------------------------------------
  const cookies = await context.cookies();
  const sessionCookieSet = cookies.some((c) =>
    c.name.includes("authjs.session-token"),
  );

  // -------------------------------------------------------------------------
  // 8. LOGIN-B2: if no callback hop and no session cookie, the OIDC flow
  //    likely failed at the token exchange stage.
  // -------------------------------------------------------------------------
  const hasCallbackHop = chain.some((h) =>
    h.url.includes("callback/zitadel"),
  );
  if (!hasCallbackHop && !sessionCookieSet) {
    console.warn(
      `[loginViaZitadelV2] LOGIN-B2 WARNING: no /api/auth/callback/zitadel hop detected ` +
        `and no session cookie set. The JWT tenant claim may be absent. ` +
        `Check auth.ts jwt callback K8s fallback (commit 659678e).`,
    );
  }

  // -------------------------------------------------------------------------
  // 9. LOGIN-B1: browser parked on signedin
  // -------------------------------------------------------------------------
  if (finalUrl.includes("/ui/v2/login/signedin")) {
    throw new Error(
      `[loginViaZitadelV2] LOGIN-B1 REGRESSION: Zitadel parked browser on /signedin. ` +
        `OIDC callback never completed. session cookie: ${sessionCookieSet}. ` +
        `Inspect the hop chain for duplicate signin/zitadel POSTs.`,
    );
  }

  console.log(
    `[loginViaZitadelV2] Login ${sessionCookieSet ? "PASSED" : "INCOMPLETE"} ` +
      `for email=${email}. finalUrl=${redactOIDCParams(finalUrl)}`,
  );

  return { finalUrl, chain, sessionCookieSet };
}
