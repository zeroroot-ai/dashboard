// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * login-via-zitadel-v2.ts, the one helper that signs a browser in.
 *
 * The dashboard has no sign-in form of its own. `/login` renders a gate card
 * with one "Sign in" button that fires Auth.js `signIn("zitadel")`, and
 * Zitadel's hosted Login v2 does the rest: email, password, then a TOTP
 * code, because ADR-0093 requires MFA on every account. This helper drives
 * exactly that path, the way a person does. It never mints a session
 * (ADR-0027, dashboard#164).
 *
 * Steps:
 *   1. Open /login. A session that is still valid lands on /dashboard at once.
 *   2. Press the gate's "Sign in" button.
 *   3. Login v2 /ui/v2/login/loginname: fill the email, submit.
 *   4. Login v2 /ui/v2/login/password: fill the password, submit.
 *   5. Login v2 MFA: /otp/time-based asks for a code from a registered
 *      authenticator (the normal case on staging), /mfa/set asks a new user to
 *      enroll one.
 *   6. Wait for the OIDC callback and the /dashboard landing.
 *
 * Selectors follow test/platform-owner/driver.mjs in zeroroot-ai/hosted, which
 * drives the same Login v2 pages daily: Login v2 marks its inputs with
 * data-testid (username-text-input, password-text-input, code-text-input) and
 * its submit with data-testid="submit-button". Role and label fallbacks stay
 * for a Login v2 build without those marks.
 *
 * Hydration: Login v2 is server-rendered Next.js. A field accepts a value
 * before React hydrates and hydration then empties it. `fillUntilHeld` reads
 * the value back and fills again until it holds (hosted#229).
 *
 * TOTP reuse: Zitadel refuses a code that was already redeemed. Two sign-ins
 * for the same account inside one 30 second window would collide, so the
 * helper remembers the last code it sent per email and waits for the next
 * window when the derivation repeats it.
 *
 * Security:
 *   - Passwords, TOTP secrets and codes are never logged.
 *   - OIDC code, state and token values are redacted from logged URLs.
 */

import { type BrowserContext, type Locator, type Page, type Response } from "@playwright/test";
import { computeTotp, getTotpSecret, rememberTotpSecret } from "./totp";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginOptions {
  /** Email address (Zitadel loginname). */
  email: string;
  /** Password for Zitadel. */
  password: string;
  /**
   * Base32 TOTP secret of the account's registered authenticator. Required
   * when Zitadel asks for a code. A secret enrolled earlier in this process
   * through the /mfa/set page is used when this is absent.
   */
  totpSecret?: string;
  /** Base URL of the product host (default: PLAYWRIGHT_BASE_URL). */
  baseURL?: string;
  /** Milliseconds to wait for the Zitadel loginname form (default: 30_000). */
  loginFormTimeoutMs?: number;
  /** Milliseconds to wait for the landing after the last submit (default: 60_000). */
  loginCompleteTimeoutMs?: number;
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
  /** OIDC redirect chain captured through page.on("response"). */
  chain: LoginHop[];
  /** Whether an Auth.js session cookie is present after login. */
  sessionCookieSet: boolean;
}

// ---------------------------------------------------------------------------
// Login v2 page plumbing
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

/** Redact OIDC code/state/id_token from a URL for safe logging. */
function redactOIDCParams(url: string): string {
  return url.replace(
    /([?&])(code|state|id_token|nonce|session_state)=[^&]+/g,
    "$1$2=<redacted>",
  );
}

function submitButton(page: Page): Locator {
  return page
    .locator('[data-testid="submit-button"]')
    .or(page.getByRole("button", { name: /next|continue|submit|sign.?in|verify/i }))
    .first();
}

/**
 * Types into a field and proves the value stayed. Login v2 resets a field
 * that was filled before hydration, so read it back and fill again until it
 * holds. A field that never holds its value is a real defect, named here.
 */
async function fillUntilHeld(
  field: Locator,
  value: string,
  label: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    await field.fill(value);
    await field.page().waitForTimeout(300);
    if ((await field.inputValue()) === value) return;
  } while (Date.now() < deadline);
  throw new Error(`[loginViaZitadelV2] the ${label} field never held its value`);
}

/** The last TOTP code submitted per email, so a second sign-in never reuses it. */
const lastCodeByEmail = new Map<string, string>();

async function freshTotpCode(email: string, secret: string): Promise<string> {
  let code = computeTotp(secret);
  while (code === lastCodeByEmail.get(email)) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    code = computeTotp(secret);
  }
  lastCodeByEmail.set(email, code);
  return code;
}

/**
 * Handles Login v2's MFA step after the password.
 *
 *   - /ui/v2/login/otp/time-based: a registered authenticator. Derive a code
 *     from `totpSecret` and submit it.
 *   - /ui/v2/login/mfa/set: first-factor enrollment for a new account. Choose
 *     the authenticator app, read the secret from the otpauth link the page
 *     renders, remember it for this process, and submit a code.
 *
 * Returns at once when neither page appears within `detectTimeoutMs`, so a
 * deployment without forced MFA still signs in.
 */
async function handleMfaIfPresented(
  page: Page,
  email: string,
  totpSecret: string | undefined,
): Promise<void> {
  const detectTimeoutMs = 15_000;
  const deadline = Date.now() + detectTimeoutMs;
  let shape: "set" | "otp" | "none" = "none";
  while (Date.now() < deadline) {
    const path = new URL(page.url()).pathname;
    if (path.includes("/ui/v2/login/mfa/set") || path.includes("/otp/time-based/set")) {
      shape = "set";
      break;
    }
    if (path.includes("/ui/v2/login/otp/time-based")) {
      shape = "otp";
      break;
    }
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

  const codeField = page
    .locator('[data-testid="code-text-input"]')
    .or(page.getByLabel(/code/i))
    .first();

  if (shape === "set") {
    console.log("[loginViaZitadelV2] MFA enrollment required, choosing the authenticator app");
    const choose = page
      .getByRole("button", { name: /authenticator app/i })
      .or(page.getByRole("link", { name: /authenticator app/i }))
      .first();
    if (await choose.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await choose.click();
    }
    // Login v2 renders the secret as an otpauth:// link beside the QR code,
    // never as bare text (hosted test/platform-owner/driver.mjs).
    const otpauthLink = page.locator('a[href^="otpauth://"]').first();
    await otpauthLink.waitFor({ timeout: 15_000 });
    const href = (await otpauthLink.getAttribute("href")) ?? "";
    const secret = new URL(href).searchParams.get("secret")?.replace(/\s+/g, "").toUpperCase();
    if (!secret) {
      throw new Error("[loginViaZitadelV2] MFA enrollment: the otpauth link carries no secret");
    }
    rememberTotpSecret(email, secret);
    await fillUntilHeld(codeField, await freshTotpCode(email, secret), "TOTP code");
    await submitButton(page).click();
    return;
  }

  const secret = totpSecret ?? getTotpSecret(email);
  if (!secret) {
    throw new Error(
      `[loginViaZitadelV2] Zitadel asked for a TOTP code for ${email} and no secret is known. ` +
        "Pass totpSecret (the lane reads E2E_ADMIN_TOTP_SECRET / E2E_MEMBER_TOTP_SECRET).",
    );
  }
  await fillUntilHeld(codeField, await freshTotpCode(email, secret), "TOTP code");
  await submitButton(page).click();
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * loginViaZitadelV2 signs the browser in through the dashboard's /login gate
 * and Zitadel's hosted Login v2.
 *
 * Returns { finalUrl, chain, sessionCookieSet }. Throws when a Login v2 page
 * never appears, when a code is required and no secret is known, or when
 * Zitadel parks the browser on /signedin (the LOGIN-B1 double-fire bug).
 */
export async function loginViaZitadelV2(
  page: Page,
  context: BrowserContext,
  opts: LoginOptions,
): Promise<LoginResult> {
  const {
    email,
    password,
    totpSecret,
    baseURL = DEFAULT_BASE_URL,
    loginFormTimeoutMs = 30_000,
    loginCompleteTimeoutMs = 60_000,
  } = opts;

  const chain: LoginHop[] = [];
  const onResponse = (resp: Response) => {
    chain.push({
      ts: new Date().toISOString(),
      status: resp.status(),
      method: resp.request().method(),
      url: redactOIDCParams(resp.url()),
    });
  };
  page.on("response", onResponse);

  try {
    // 1. The gate.
    console.log(`[loginViaZitadelV2] opening ${baseURL}/login`);
    await page.goto(`${baseURL}/login`, { waitUntil: "load", timeout: loginFormTimeoutMs });

    if (page.url().includes("/dashboard")) {
      console.log(`[loginViaZitadelV2] already signed in, landed on ${page.url()}`);
      const cookies = await context.cookies();
      return {
        finalUrl: page.url(),
        chain,
        sessionCookieSet: cookies.some((c) => c.name.includes("authjs.session-token")),
      };
    }

    // 2. Press "Sign in". The click starts an OIDC redirect chain, so it must
    //    not wait for a navigation of its own. A click that lands before
    //    React attached the handler changes nothing, so retry once.
    const gateButton = page.getByRole("button", { name: /^sign in$/i }).first();
    await gateButton.waitFor({ state: "visible", timeout: loginFormTimeoutMs });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await gateButton.click({ noWaitAfter: true }).catch(() => undefined);
      const left = await page
        .waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (left) break;
      console.log(`[loginViaZitadelV2] the gate click changed nothing (attempt ${attempt})`);
    }

    // 3. Loginname.
    try {
      await page.waitForURL(/\/ui\/v2\/login\/loginname/, { timeout: loginFormTimeoutMs });
    } catch {
      const current = page.url();
      if (current.includes("/ui/v2/login/signedin")) {
        throw new Error(
          "[loginViaZitadelV2] LOGIN-B1 REGRESSION: Zitadel parked the browser on /signedin " +
            `before the loginname page. URL=${redactOIDCParams(current)}`,
        );
      }
      throw new Error(
        "[loginViaZitadelV2] the Zitadel loginname page never appeared. " +
          `URL=${redactOIDCParams(current)}`,
      );
    }
    const loginnameField = page
      .locator('[data-testid="username-text-input"]')
      .or(page.getByLabel(/login.?name|email|user/i))
      .first();
    await fillUntilHeld(loginnameField, email, "loginname");
    await submitButton(page).click();

    // 4. Password.
    try {
      await page.waitForURL(/\/ui\/v2\/login\/password/, { timeout: 20_000 });
    } catch {
      throw new Error(
        "[loginViaZitadelV2] the Zitadel password page never appeared. " +
          `URL=${redactOIDCParams(page.url())}. Check that the account exists.`,
      );
    }
    const passwordField = page
      .locator('[data-testid="password-text-input"]')
      .or(page.locator('input[type="password"]'))
      .first();
    await fillUntilHeld(passwordField, password, "password");
    await submitButton(page).click();

    // 5. MFA.
    await handleMfaIfPresented(page, email, totpSecret);

    // 6. Landing.
    await page
      .waitForURL(
        (url) =>
          url.pathname.startsWith("/api/auth/callback/zitadel") ||
          url.pathname.startsWith("/dashboard") ||
          url.pathname === "/" ||
          url.pathname.includes("/ui/v2/login/signedin"),
        { timeout: loginCompleteTimeoutMs },
      )
      .catch(() => {
        console.log(
          `[loginViaZitadelV2] the landing wait timed out at ${redactOIDCParams(page.url())}`,
        );
      });

    const finalUrl = page.url();
    const cookies = await context.cookies();
    const sessionCookieSet = cookies.some((c) => c.name.includes("authjs.session-token"));

    if (finalUrl.includes("/ui/v2/login/signedin")) {
      throw new Error(
        "[loginViaZitadelV2] LOGIN-B1 REGRESSION: Zitadel parked the browser on /signedin. " +
          `The OIDC callback never completed. session cookie: ${sessionCookieSet}.`,
      );
    }

    console.log(
      `[loginViaZitadelV2] sign-in ${sessionCookieSet ? "PASSED" : "INCOMPLETE"} ` +
        `for ${email}. finalUrl=${redactOIDCParams(finalUrl)}`,
    );
    return { finalUrl, chain, sessionCookieSet };
  } finally {
    page.off("response", onResponse);
  }
}
