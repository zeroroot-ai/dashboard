/**
 * signup-trace.spec.ts, focused diagnostic for the signup chain.
 *
 * Single-purpose diagnostic tool. Drives the real signup form against the
 * live Kind cluster, waits for the ProvisioningPanel to reach its terminal
 * success state, and dumps per-step evidence to JSON.
 *
 * NOT a full e2e test. Invoked by signup-trace.sh (via `npx playwright test`).
 *
 * Inputs (env):
 *   TRACE_SLUG    , workspace slug to use (defaults to trace-<timestamp>)
 *   TRACE_EMAIL   , email to use (defaults to <slug>@trace.zeroroot.local)
 *   TRACE_PASSWORD, password (defaults to a generated secure password)
 *   PLAYWRIGHT_BASE_URL, defaults to https://app.zeroroot.local:30443
 *
 * Outputs:
 *   /tmp/signup-trace-result.json , per-step status, final URL, panel state
 *   /tmp/signup-trace-final.png   , screenshot of final page state
 *
 * Run via:
 *   E2E_AUTH_SUITE=1 npx playwright test e2e/auth/signup-trace.spec.ts \
 *     --project=chromium --reporter=list --timeout=180000 --workers=1
 */

import { test, expect } from "@playwright/test";
import * as fs from "fs";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "https://app.zeroroot.local:30443";

const now = Date.now();
const SLUG = process.env.TRACE_SLUG ?? `trace-${String(now).slice(-8)}`;
const EMAIL = process.env.TRACE_EMAIL ?? `${SLUG}@trace.zeroroot.local`;
const PASSWORD = process.env.TRACE_PASSWORD ?? `Ae1!trace${String(now).slice(-6)}`;

interface TraceResult {
  slug: string;
  email: string;
  steps: { step: string; status: string; ts: string }[];
  finalUrl: string;
  panelState: string;
  sessionCookieSet: boolean;
  error?: string;
}

test("signup-trace: drive real signup form and capture provisioning state", async ({ page, context }) => {
  const result: TraceResult = {
    slug: SLUG,
    email: EMAIL,
    steps: [],
    finalUrl: "",
    panelState: "unknown",
    sessionCookieSet: false,
  };

  const addStep = (step: string, status: string) => {
    result.steps.push({ step, status, ts: new Date().toISOString() });
    console.log(`[signup-trace] ${status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : "..."} ${step}`);
  };

  try {
    // Step 1: Navigate to signup form
    addStep("navigate /signup?plan=solo", "...");
    await page.goto(`${BASE}/signup?plan=solo`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page).toHaveURL(/\/signup/, { timeout: 15_000 });
    addStep("navigate /signup?plan=solo", "PASS");

    // Step 2: Fill firstName
    addStep("fill firstName", "...");
    await page.getByLabel(/first name/i).fill("Trace");
    addStep("fill firstName", "PASS");

    // Step 3: Fill lastName
    addStep("fill lastName", "...");
    await page.getByLabel(/last name/i).fill("User");
    addStep("fill lastName", "PASS");

    // Step 4: Fill email
    addStep("fill email", "...");
    await page.getByLabel(/work email/i).fill(EMAIL);
    addStep("fill email", "PASS");

    // Step 5: Fill password
    addStep("fill password", "...");
    await page.locator('input[type="password"]').first().fill(PASSWORD);
    addStep("fill password", "PASS");

    // Step 6: Fill confirm password
    addStep("fill passwordConfirm", "...");
    // The confirm field is the second password input
    const pwInputs = page.locator('input[type="password"]');
    const count = await pwInputs.count();
    if (count >= 2) {
      await pwInputs.nth(1).fill(PASSWORD);
    } else {
      // Form may toggle confirm visibility; try by label
      await page.getByLabel(/confirm password/i).fill(PASSWORD);
    }
    addStep("fill passwordConfirm", "PASS");

    // Step 7: Fill workspaceName
    // Use the slug directly so the Tenant CR name matches what tests expect.
    addStep("fill workspaceName", "...");
    await page.getByLabel(/workspace name/i).fill(SLUG);
    addStep("fill workspaceName", "PASS");

    // Step 8: Accept ToS checkbox (labeled "I agree to the Terms of Service")
    addStep("check acceptToS", "...");
    await page.locator("#acceptToS").check();
    addStep("check acceptToS", "PASS");

    // Step 9: Accept Privacy checkbox
    addStep("check acceptPrivacy", "...");
    await page.locator("#acceptPrivacy").check();
    addStep("check acceptPrivacy", "PASS");

    // Step 10: Submit form
    addStep("click Create account", "...");
    await page.getByRole("button", { name: /create account/i }).click();
    addStep("click Create account", "PASS");

    // Step 11: Wait for ProvisioningPanel to appear (the form disappears and
    // the panel with "$ validating credentials" etc. appears)
    addStep("wait for ProvisioningPanel", "...");
    try {
      // Panel renders inside the same /signup route, not a navigation.
      // Look for the terminal step label "$ granting root" appearing as done
      // or the panel's success state which triggers window.location.assign
      await page.waitForURL(
        (url) =>
          url.pathname.startsWith("/login") ||
          url.pathname.startsWith("/dashboard"),
        { timeout: 120_000 },
      );
      result.panelState = "navigated-away";
      addStep("wait for ProvisioningPanel", "PASS");
    } catch {
      // Maybe still on /signup with panel visible, check panel state
      const currentUrl = page.url();
      if (currentUrl.includes("/signup")) {
        const panelText = await page.locator('[role="status"]').textContent().catch(() => "");
        result.panelState = `panel-visible:${panelText?.slice(0, 100)}`;
        addStep("wait for ProvisioningPanel", "WARN: still on signup");
      } else {
        result.panelState = `url:${currentUrl}`;
        addStep("wait for ProvisioningPanel", "PASS: landed elsewhere");
      }
    }

    result.finalUrl = page.url();

    // Step 12: Check session cookie
    const cookies = await context.cookies();
    result.sessionCookieSet = cookies.some(
      (c) => c.name.includes("authjs.session-token") || c.name.includes("__Secure-authjs"),
    );
    addStep(`session cookie set: ${result.sessionCookieSet}`, result.sessionCookieSet ? "PASS" : "WARN");

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    addStep("signup-trace", `FAIL: ${result.error?.slice(0, 200)}`);
  }

  // Always dump outputs
  await page.screenshot({ path: "/tmp/signup-trace-final.png", fullPage: true });
  fs.writeFileSync("/tmp/signup-trace-result.json", JSON.stringify(result, null, 2));
  console.log("[signup-trace] dumped /tmp/signup-trace-{result.json,final.png}");
  console.log(`[signup-trace] FINAL URL: ${result.finalUrl}`);
  console.log(`[signup-trace] panel state: ${result.panelState}`);

  // Surface failures
  if (result.error) {
    throw new Error(`[signup-trace] FAILED: ${result.error}`);
  }

  // Assert we navigated away from /signup (panel reached terminal success)
  expect(result.finalUrl).toMatch(/\/(login|dashboard)/);
});
