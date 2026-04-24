/**
 * login-trace.spec.ts — focused diagnostic for the OIDC redirect chain.
 *
 * NOT a full e2e test. Single-purpose tool to capture WHY the browser ends
 * up parked on Zitadel's /ui/v2/login/signedin instead of completing the
 * OIDC flow back to /api/auth/callback/zitadel.
 *
 * Skips signup entirely — assumes the user already exists. Drives /login,
 * watches every navigation + every response status, dumps the chain to
 * /tmp/login-trace-chain.json, and screenshots the final state.
 *
 * Inputs (env):
 *   TRACE_EMAIL    — pre-existing Zitadel user email (required)
 *   TRACE_PASSWORD — that user's password (required)
 *   PLAYWRIGHT_BASE_URL — defaults to https://app.zero-day.local:30443
 *
 * Output:
 *   /tmp/login-trace-chain.json    — every response observed during the flow
 *   /tmp/login-trace-final.png     — final page screenshot
 *   /tmp/login-trace-cookies.json  — cookies at end of flow (values redacted)
 *
 * Run via:
 *   TRACE_EMAIL=anthony@zero-day.ai TRACE_PASSWORD='…' \
 *   PLAYWRIGHT_BASE_URL=https://app.zero-day.local:30443 \
 *   E2E_AUTH_SUITE=1 \
 *   npx playwright test e2e/auth/login-trace.spec.ts \
 *     --project=chromium --reporter=list --timeout=120000 --workers=1
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zero-day.local:30443";

interface Hop {
  ts: string;
  status: number;
  method: string;
  url: string;
}

function redactCode(u: string): string {
  return u.replace(/([?&])(code|state|id_token)=[^&]+/g, "$1$2=<redacted>");
}

test("login-trace: capture OIDC redirect chain", async ({ page, context }) => {
  const email = process.env.TRACE_EMAIL;
  const password = process.env.TRACE_PASSWORD;
  if (!email || !password) {
    throw new Error("TRACE_EMAIL and TRACE_PASSWORD must be set");
  }

  const chain: Hop[] = [];
  page.on("response", (resp) => {
    chain.push({
      ts: new Date().toISOString(),
      status: resp.status(),
      method: resp.request().method(),
      url: redactCode(resp.url()),
    });
  });

  // Step 1: visit /login. LoginForm's useEffect fires signIn("zitadel", …)
  // which POSTs to /api/auth/signin/zitadel and 302s to Zitadel.
  console.log("[trace] step 1: GET /login");
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 30_000 });

  // Step 2: wait for Zitadel V2 login UI to render the loginname form.
  console.log("[trace] step 2: wait for Zitadel loginname form");
  try {
    await page.waitForURL(/\/ui\/v2\/login\/loginname/, { timeout: 30_000 });
  } catch {
    console.log(`[trace] never reached /ui/v2/login/loginname — current URL=${page.url()}`);
    await page.screenshot({ path: "/tmp/login-trace-final.png", fullPage: true });
    fs.writeFileSync("/tmp/login-trace-chain.json", JSON.stringify(chain, null, 2));
    throw new Error(`Step 2 failed. See /tmp/login-trace-{chain.json,final.png}`);
  }

  // Step 3: fill loginname (email) and submit.
  console.log("[trace] step 3: fill loginname");
  await page.getByLabel(/login.?name|email|user/i).first().fill(email);
  await page.getByRole("button", { name: /next|continue|submit/i }).first().click();

  // Step 4: wait for Zitadel V2 to render the password form.
  console.log("[trace] step 4: wait for Zitadel password form");
  try {
    await page.waitForURL(/\/ui\/v2\/login\/password/, { timeout: 20_000 });
  } catch {
    console.log(`[trace] never reached /ui/v2/login/password — current URL=${page.url()}`);
    await page.screenshot({ path: "/tmp/login-trace-final.png", fullPage: true });
    fs.writeFileSync("/tmp/login-trace-chain.json", JSON.stringify(chain, null, 2));
    throw new Error(`Step 4 failed. See /tmp/login-trace-{chain.json,final.png}`);
  }

  // Step 5: fill password and submit.
  console.log("[trace] step 5: fill password");
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole("button", { name: /next|continue|submit|sign.?in/i }).first().click();

  // Step 6: wait for landing on dashboard's /api/auth/callback/zitadel
  // (success) OR Zitadel /signedin (the bug we're tracing).
  console.log("[trace] step 6: wait for terminal landing");
  try {
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith("/api/auth/callback/zitadel") ||
        url.pathname.startsWith("/dashboard") ||
        url.pathname === "/" ||
        url.pathname.includes("/ui/v2/login/signedin"),
      { timeout: 60_000 },
    );
  } catch (err) {
    console.log(`[trace] terminal wait timed out — current URL=${page.url()}`);
  }

  const finalUrl = redactCode(page.url());
  console.log(`[trace] FINAL URL: ${finalUrl}`);
  console.log(`[trace] hops captured: ${chain.length}`);

  // Dump everything for diagnosis.
  await page.screenshot({ path: "/tmp/login-trace-final.png", fullPage: true });
  fs.writeFileSync("/tmp/login-trace-chain.json", JSON.stringify(chain, null, 2));

  const cookies = (await context.cookies()).map((c) => ({
    name: c.name,
    domain: c.domain,
    path: c.path,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: c.sameSite,
    valueLength: c.value.length,
  }));
  fs.writeFileSync("/tmp/login-trace-cookies.json", JSON.stringify(cookies, null, 2));

  console.log("[trace] dumped /tmp/login-trace-{chain.json,final.png,cookies.json}");

  // Surface the diagnosis.
  const sessionCookieSet = cookies.some((c) =>
    c.name.includes("authjs.session-token"),
  );
  if (finalUrl.includes("/signedin")) {
    throw new Error(
      `[trace] DIAGNOSED: Zitadel V2 UI parked browser on /signedin instead of redirecting to dashboard callback. ` +
        `session cookie set: ${sessionCookieSet}. ` +
        `Inspect /tmp/login-trace-chain.json for the last few hops Zitadel made before stopping.`,
    );
  }
  expect(sessionCookieSet, "Auth.js session cookie should be set after login").toBe(true);
});
