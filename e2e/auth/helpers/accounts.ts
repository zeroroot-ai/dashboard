// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * accounts.ts, the two real accounts the staging lane signs in with.
 *
 * The lane never forges a session (ADR-0027, dashboard#164). A spec that
 * needs a signed-in browser signs in the way a person does, through the
 * /login gate and Zitadel's hosted Login v2 (see login-via-zitadel-v2.ts).
 *
 * The accounts are repository secrets on zeroroot-ai/dashboard, exported by
 * .github/workflows/exit-test-e2e-staging.yml:
 *
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET
 *       the Owner or an Admin of the e2e tenant on staging.
 *   E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD, E2E_MEMBER_TOTP_SECRET
 *       a Viewer of the same tenant.
 *
 * ADR-0093 requires MFA on every account, so each account carries the base32
 * secret of its registered authenticator app.
 *
 * A spec calls `requireAdmin()` or `requireMember()` inside the test body.
 * When the variables are unset the test skips with a reason that names them.
 * The lane's skip floor (e2e/skip-floor.mjs) fails a run in which every test
 * skipped, so an unset secret is visible, never green.
 */

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { loginViaZitadelV2 } from "./login-via-zitadel-v2";

export interface Account {
  email: string;
  password: string;
  totpSecret?: string;
}

/** The product host under test. The lane sets PLAYWRIGHT_BASE_URL. */
export const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

function readAccount(prefix: "E2E_ADMIN" | "E2E_MEMBER"): Account | null {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  if (!email || !password) return null;
  const totpSecret = process.env[`${prefix}_TOTP_SECRET`];
  return { email, password, totpSecret: totpSecret || undefined };
}

export const ADMIN_SKIP_REASON =
  "E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD are not set (plus E2E_ADMIN_TOTP_SECRET on an MFA account)";
export const MEMBER_SKIP_REASON =
  "E2E_MEMBER_EMAIL and E2E_MEMBER_PASSWORD are not set (plus E2E_MEMBER_TOTP_SECRET on an MFA account)";

/** The admin account, or a skip of the current test when it is not configured. */
export function requireAdmin(): Account {
  const account = readAccount("E2E_ADMIN");
  test.skip(!account, ADMIN_SKIP_REASON);
  return account as Account;
}

/** The member account, or a skip of the current test when it is not configured. */
export function requireMember(): Account {
  const account = readAccount("E2E_MEMBER");
  test.skip(!account, MEMBER_SKIP_REASON);
  return account as Account;
}

/**
 * Signs `account` in through Zitadel and waits for the /dashboard landing.
 * Fails the test when no session cookie was set.
 */
export async function signIn(
  page: Page,
  context: BrowserContext,
  account: Account,
): Promise<void> {
  const result = await loginViaZitadelV2(page, context, {
    email: account.email,
    password: account.password,
    totpSecret: account.totpSecret,
    baseURL: BASE_URL,
  });
  expect(
    result.sessionCookieSet,
    `no Auth.js session cookie after signing in as ${account.email}`,
  ).toBe(true);
  await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
    timeout: 30_000,
  });
}
