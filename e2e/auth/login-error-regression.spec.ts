// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * login-error-regression.spec.ts
 *
 * Every LoginErrorReason value renders the deterministic /login/error page:
 * the page stays at /login/error, shows the copy from ERROR_COPY, shows a
 * correlation ID and a CTA, and never redirects to
 * /api/auth/federated-signout. An unknown reason collapses to "unknown"
 * (safeReason in src/lib/auth/error-codes.ts).
 *
 * This is the public half of the former fault-injection suite. The fault
 * half needed TEST_FIXTURES_ENABLED on the server and a fresh signup per
 * test. Neither exists on staging: the flag must never be set on a shared
 * environment, and the daemon sends the signup mail through SES, which the
 * lane cannot read.
 *
 * No sign-in is needed: /login/error is a public route.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers/accounts";
import { ERROR_COPY, type LoginErrorReason } from "../../src/lib/auth/error-codes";

const REASONS = Object.keys(ERROR_COPY) as LoginErrorReason[];

test.describe("login-error-regression: /login/error renders every reason", () => {
  test("the route exists in this build", async ({ request }) => {
    const probe = await request.get(`${BASE_URL}/login/error?reason=unknown`);
    expect(probe.status(), "/login/error must be served").toBe(200);
  });

  for (const reason of REASONS) {
    test(`reason=${reason} renders its copy, a correlation ID and a CTA`, async ({ page }) => {
      await page.goto(`${BASE_URL}/login/error?reason=${reason}`, {
        waitUntil: "networkidle",
        timeout: 20_000,
      });

      const finalUrl = page.url();
      expect(finalUrl, "must not redirect to federated-signout").not.toContain(
        "federated-signout",
      );
      expect(finalUrl, "must stay on /login/error").toContain("/login/error");

      const copy = ERROR_COPY[reason];
      await expect(page.getByText(copy.title, { exact: false }).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/correlation id/i)).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByRole("link", { name: copy.cta.label }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });
  }

  test("an injected reason collapses to the unknown page", async ({ page }) => {
    await page.goto(`${BASE_URL}/login/error?reason=some_injected_value`, {
      waitUntil: "networkidle",
      timeout: 20_000,
    });
    expect(page.url()).toContain("/login/error");
    await expect(
      page.getByText(ERROR_COPY.unknown.title, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/correlation id/i)).toBeVisible({ timeout: 10_000 });
  });
});
