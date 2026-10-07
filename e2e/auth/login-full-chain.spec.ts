// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * login-full-chain.spec.ts, the browser half of the login full-chain test
 * (dashboard#12, gibson#215).
 *
 * The Go half in zeroroot-ai/gibson (tests/e2e/login_full_chain_test.go)
 * asserts on the cluster side: the OIDC redirect chain, the session cookie,
 * the identity behind it, and the negative cases. It reads the files this
 * spec writes. The files go to the private directory of the run
 * (helpers/artifact-dir.ts, E2E_ARTIFACT_DIR), never to a fixed /tmp name.
 *
 * Files, where <slug> is E2E_ARTIFACT_SLUG:
 *   login-redirect-chain-<slug>.json             [{from, to, status, method}]
 *   login-storage-state-<slug>.json              Playwright storage state, account A
 *   login-storage-state-<slug>-b.json            Playwright storage state, account B
 *   login-negative-wrong-password-<slug>.json    storage state after a bad password
 *   login-negative-nonexistent-email-<slug>.json storage state after an unknown email
 *   login-negative-expired-<slug>.json           {redirectedToLogin, hasRedirectToParam, finalUrl}
 *
 * The spec runs only for an orchestrator that runs the Go half, so it skips
 * unless E2E_ARTIFACT_SLUG is set. Accounts: E2E_ADMIN_* is account A and
 * E2E_MEMBER_* is account B (helpers/accounts.ts).
 */

import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";

import { BASE_URL, requireAdmin, requireMember, signIn } from "./helpers/accounts";
import { writeArtifact } from "./helpers/artifact-dir";
import { loginViaZitadelV2, type LoginHop } from "./helpers/login-via-zitadel-v2";

const SLUG = process.env.E2E_ARTIFACT_SLUG ?? "";

/** One hop of the redirect chain as the Go half reads it (helpers.RedirectStep). */
interface RedirectStep {
  from: string;
  to: string;
  status: number;
  method: string;
}

/** Turns the responses of the sign-in into from/to steps. */
function toRedirectSteps(chain: LoginHop[]): RedirectStep[] {
  return chain.map((hop, i) => ({
    from: i === 0 ? "" : chain[i - 1].url,
    to: hop.url,
    status: hop.status,
    method: hop.method,
  }));
}

async function saveState(context: BrowserContext, name: string): Promise<void> {
  writeArtifact(name, await context.storageState());
}

test.describe("login full chain, browser half", () => {
  test.skip(!SLUG, "E2E_ARTIFACT_SLUG is not set. This spec writes files for the Go half of gibson#215");
  // Sign-ins of the same account must not share a TOTP window.
  test.describe.configure({ mode: "serial" });

  test("account A signs in, and the chain and the session are written", async ({ page, context }) => {
    test.setTimeout(150_000);
    const account = requireAdmin();
    const result = await loginViaZitadelV2(page, context, {
      email: account.email,
      password: account.password,
      totpSecret: account.totpSecret,
      baseURL: BASE_URL,
    });
    expect(result.sessionCookieSet).toBe(true);
    writeArtifact(`login-redirect-chain-${SLUG}.json`, toRedirectSteps(result.chain));
    await saveState(context, `login-storage-state-${SLUG}.json`);
  });

  test("account B signs in, for the cross-talk check", async ({ page, context }) => {
    test.setTimeout(150_000);
    await signIn(page, context, requireMember());
    await saveState(context, `login-storage-state-${SLUG}-b.json`);
  });

  test("a wrong password sets no session", async ({ page, context }) => {
    test.setTimeout(150_000);
    const account = requireAdmin();
    await loginViaZitadelV2(page, context, {
      email: account.email,
      password: `wrong-${randomBytes(8).toString("hex")}`,
      baseURL: BASE_URL,
      loginCompleteTimeoutMs: 15_000,
    }).catch(() => undefined);
    await saveState(context, `login-negative-wrong-password-${SLUG}.json`);
  });

  test("an unknown email sets no session", async ({ page, context }) => {
    test.setTimeout(150_000);
    await loginViaZitadelV2(page, context, {
      email: `nobody-${randomBytes(6).toString("hex")}@e2e.invalid`,
      password: `wrong-${randomBytes(8).toString("hex")}`,
      baseURL: BASE_URL,
      loginCompleteTimeoutMs: 15_000,
    }).catch(() => undefined);
    await saveState(context, `login-negative-nonexistent-email-${SLUG}.json`);
  });

  test("an expired session goes back to /login", async ({ page, context }) => {
    test.setTimeout(150_000);
    await signIn(page, context, requireAdmin());
    // Browsers refuse a cookie with an expiry in the past, so the session
    // cookie is removed. Auth.js reads a missing and an expired cookie the
    // same way (session-expiry.spec.ts).
    await context.clearCookies();
    await page.goto(`${BASE_URL}/dashboard`);
    await page
      .waitForURL((url) => url.pathname.startsWith("/login"), { timeout: 20_000 })
      .catch(() => undefined);
    const finalUrl = new URL(page.url());
    writeArtifact(`login-negative-expired-${SLUG}.json`, {
      redirectedToLogin: finalUrl.pathname.startsWith("/login"),
      hasRedirectToParam: finalUrl.searchParams.has("callbackUrl") || finalUrl.searchParams.has("redirect_to"),
      finalUrl: `${finalUrl.origin}${finalUrl.pathname}`,
    });
  });
});
