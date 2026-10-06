// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * invite-quickstart.spec.ts, the generated screenshots of the published
 * quickstart for an invited person (docs-site invited.mdx, dashboard#149).
 *
 * The screenshots are generated, never captured by hand, so a UI change is a
 * re-run. The task needs a live cluster: middleware.ts resolves the
 * membership on the server, and page.route() intercepts only browser
 * fetches, so a stubbed backend cannot render a signed-in page.
 *
 * Run it on purpose. It skips unless E2E_SCREENSHOT_DIR names the output
 * directory:
 *
 *   PLAYWRIGHT_BASE_URL=... E2E_MAILPIT_URL=... E2E_ADMIN_EMAIL=... \
 *     E2E_ADMIN_PASSWORD=... E2E_ADMIN_TOTP_SECRET=... \
 *     E2E_SCREENSHOT_DIR=./quickstart-shots \
 *     pnpm test:e2e e2e/visual/invite-quickstart.spec.ts
 *
 * Output files, one per step, overwritten on each run:
 *   invite-dialog-roles.png, invited-row.png, invite-accept.png,
 *   sign-in.png, first-dashboard.png, settings-cli.png
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { BASE_URL } from "../auth/helpers/accounts";
import { accept, firstSignIn, inviteNewPerson } from "../auth/helpers/invite-flow";
import { requireMailpit } from "../auth/helpers/mailpit";

const OUT_DIR = process.env.E2E_SCREENSHOT_DIR;

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(OUT_DIR as string, `${name}.png`), fullPage: false });
}

test("the invited-person quickstart screenshots", async ({ page, context }) => {
  test.skip(!OUT_DIR, "E2E_SCREENSHOT_DIR is not set. The screenshot task runs only on request");
  test.setTimeout(360_000);
  const mailpitURL = requireMailpit();
  mkdirSync(OUT_DIR as string, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });

  const invitee = await inviteNewPerson(page, context, mailpitURL, "Editor", {
    roleListOpen: (p) => shot(p, "invite-dialog-roles"),
    invitedRow: (p) => shot(p, "invited-row"),
  });

  await context.clearCookies();
  const setupLink = await accept(page, invitee.acceptLink);
  await shot(page, "invite-accept");

  // The sign-in screen: the gate of /login, which the invitee meets after
  // the account setup.
  await page.goto(`${BASE_URL}/login`);
  await expect(page.getByRole("button", { name: /sign in/i }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "sign-in");

  await firstSignIn(page, context, invitee, setupLink);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.waitForLoadState("networkidle");
  await shot(page, "first-dashboard");

  await page.goto(`${BASE_URL}/dashboard/pages/settings/cli`);
  await page.waitForLoadState("networkidle");
  await shot(page, "settings-cli");
});
