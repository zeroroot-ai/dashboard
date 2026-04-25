/**
 * login-via-zitadel-v2.ts — canonical helper that drives the Zitadel V2 login UI.
 *
 * ONE function — no per-spec Zitadel selector reimplementations. All login
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoginOptions {
  /** Email address (Zitadel loginname). */
  email: string;
  /** Password for Zitadel. Must match Zitadel password policy. */
  password: string;
  /** Base URL of the cluster (default: PLAYWRIGHT_BASE_URL env or https://app.zero-day.local:30443). */
  baseURL?: string;
  /** Milliseconds to wait for Zitadel loginname form to appear (default: 30_000). */
  loginFormTimeoutMs?: number;
  /** Milliseconds to wait for the terminal landing after password submit (default: 60_000). */
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
  /** OIDC redirect chain captured via page.on('response'). */
  chain: LoginHop[];
  /** Whether an authjs session cookie is present after login. */
  sessionCookieSet: boolean;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zero-day.local:30443";

/** Redact OIDC code/state/id_token from a URL for safe logging. */
function redactOIDCParams(url: string): string {
  return url.replace(
    /([?&])(code|state|id_token|nonce|session_state)=[^&]+/g,
    "$1$2=<redacted>",
  );
}

/**
 * loginViaZitadelV2 — drives the Zitadel V2 OIDC login UI against the live cluster.
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
    console.log(`[loginViaZitadelV2] Already authenticated — landed on ${page.url()}`);
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
  // 2. Wait for Zitadel V2 loginname form.
  //    LOGIN-B1: if /login triggered two POSTs to signin/zitadel, Zitadel
  //    will park the browser on /signedin instead of /loginname.
  // -------------------------------------------------------------------------
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
        `Ensure signIn("zitadel") fired on /login page load.`,
    );
  }

  // -------------------------------------------------------------------------
  // 3. Fill loginname (email) and submit.
  // -------------------------------------------------------------------------
  console.log(`[loginViaZitadelV2] filling loginname`);
  await page.getByLabel(/login.?name|email|user/i).first().fill(email);
  await page.getByRole("button", { name: /next|continue|submit/i }).first().click();

  // -------------------------------------------------------------------------
  // 4. Wait for Zitadel V2 password form.
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // 5. Fill password and submit.
  // -------------------------------------------------------------------------
  console.log(`[loginViaZitadelV2] filling password`);
  await page.locator('input[type="password"]').first().fill(password);
  await page
    .getByRole("button", { name: /next|continue|submit|sign.?in/i })
    .first()
    .click();

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
      `[loginViaZitadelV2] terminal wait timed out — current URL=${page.url()}`,
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
