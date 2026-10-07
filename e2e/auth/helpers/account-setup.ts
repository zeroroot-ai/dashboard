// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * account-setup.ts, completes a one-time setup link of Zitadel's hosted
 * Login v2: verify the invite code, set a password, enroll an authenticator
 * app. It returns the TOTP secret, so the spec can sign the new account in.
 *
 * The steps and the selectors follow the Platform owner drill of
 * zeroroot-ai/hosted (test/platform-owner/driver.mjs), which drives the same
 * pages daily. Login v2 marks its inputs with data-testid
 * (code-text-input, password-set-text-input,
 * password-set-confirm-text-input) and its submit with
 * data-testid="submit-button".
 *
 * The password and the secret are never logged.
 */

import { type Locator, type Page } from "@playwright/test";
import { computeTotp, rememberTotpSecret } from "./totp";

async function fillUntilHeld(field: Locator, value: string, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  do {
    await field.fill(value);
    await field.page().waitForTimeout(300);
    if ((await field.inputValue()) === value) return;
  } while (Date.now() < deadline);
  throw new Error(`[accountSetup] the ${label} field never held its value`);
}

/**
 * Presses the submit button once it is enabled, and returns once the page
 * moved on. Login v2 keeps the button disabled until React hydrated the
 * form, so the fields are typed again while it waits.
 */
async function submitFilled(page: Page, fields: Array<[Locator, string]>, label: string): Promise<void> {
  const submit = page.locator('[data-testid="submit-button"]');
  const startUrl = page.url();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    if (page.url() !== startUrl) return;
    if (await submit.isEnabled().catch(() => false)) {
      await submit.click();
      await page.waitForURL((u) => u.toString() !== startUrl, { timeout: 15_000 }).catch(() => {});
      return;
    }
    for (const [field, value] of fields) {
      if (!(await field.isVisible().catch(() => false))) return;
      await field.fill("", { timeout: 5_000 });
      await field.pressSequentially(value, { delay: 25, timeout: 10_000 });
    }
  }
  throw new Error(`[accountSetup] the ${label} form never enabled its submit button`);
}

/**
 * Completes the setup link that `page` shows: the invite code, a password
 * and an authenticator app. Returns the base32 TOTP secret. It returns only
 * after the TOTP window of the enrollment code ended, because Zitadel
 * refuses a code that was already redeemed and the next sign-in derives a
 * code from the same secret.
 */
export async function completeAccountSetup(
  page: Page,
  setupLink: string,
  email: string,
  password: string,
): Promise<string> {
  await page.goto(setupLink);

  const setPasswordLink = page
    .locator('a[href*="/ui/v2/login/password/set"]')
    .or(page.getByRole("button", { name: /set.*password/i }))
    .or(page.getByRole("link", { name: /set.*password/i }));
  const passwordField = page
    .locator('[data-testid="password-set-text-input"]')
    .or(page.getByLabel(/^password$/i));
  const codeField = page.locator('[data-testid="code-text-input"]');

  await passwordField.or(setPasswordLink).or(codeField).first().waitFor({ timeout: 30_000 });
  if (await codeField.isVisible()) {
    const inviteCode = new URL(page.url()).searchParams.get("code") ?? new URL(setupLink).searchParams.get("code");
    if (!inviteCode) {
      throw new Error("[accountSetup] the verify page asks for a code, but the setup link carries none");
    }
    await fillUntilHeld(codeField, inviteCode, "invite code");
    await submitFilled(page, [[codeField, inviteCode]], "invite code");
    await passwordField.or(setPasswordLink).first().waitFor({ timeout: 30_000 });
  }
  if (await setPasswordLink.count()) {
    await setPasswordLink.first().click();
  }

  await fillUntilHeld(passwordField.first(), password, "password");
  const setFields: Array<[Locator, string]> = [[passwordField.first(), password]];
  const confirmField = page
    .locator('[data-testid="password-set-confirm-text-input"]')
    .or(page.getByLabel(/confirm password/i));
  if (await confirmField.count()) {
    await fillUntilHeld(confirmField.first(), password, "confirm password");
    setFields.push([confirmField.first(), password]);
  }
  await submitFilled(page, setFields, "set password");

  const totpChoice = page
    .locator('a[href*="/otp/time-based"]')
    .or(page.getByRole("button", { name: /authenticator app|totp/i }))
    .or(page.getByRole("link", { name: /authenticator app|totp/i }));
  const otpauthLink = page.locator('a[href^="otpauth://"]');
  await totpChoice.or(otpauthLink).first().waitFor({ timeout: 30_000 });
  if (!(await otpauthLink.count()) && (await totpChoice.count())) {
    await totpChoice.first().click();
  }
  await otpauthLink.first().waitFor({ timeout: 30_000 });
  const href = (await otpauthLink.first().getAttribute("href")) ?? "";
  const secret = new URL(href).searchParams.get("secret")?.replace(/\s+/g, "").toUpperCase();
  if (!secret) {
    throw new Error("[accountSetup] the otpauth link carries no secret");
  }
  rememberTotpSecret(email, secret);

  const code = computeTotp(secret);
  const enrollCode = page.locator('[data-testid="code-text-input"]');
  await fillUntilHeld(enrollCode, code, "TOTP code");
  await submitFilled(page, [[enrollCode, code]], "TOTP enrollment");
  while (computeTotp(secret) === code) {
    await page.waitForTimeout(1_000);
  }
  return secret;
}
