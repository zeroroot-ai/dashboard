// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * invite.spec.ts, the invite-to-first-sign-in flow (dashboard#149).
 *
 * The invitation is the only way a person joins a tenant. It broke once in a
 * way no test caught: the accept link was built from the API origin, which
 * serves no /invite/<token> route, so every invitation email returned 404
 * until hosted#203 fixed it. This spec holds that fix and the rest of the
 * chain:
 *
 *   1. An admin invites an address, and the address shows as an invited row.
 *   2. The accept link in the delivered email is on the PRODUCT origin, the
 *      one the browser uses for the dashboard. That one assertion is the
 *      regression guard for hosted#203.
 *   3. The link reaches "You're in" and hands over a one-time setup link.
 *   4. The invitee sets a password, enrolls an authenticator app, signs in,
 *      and lands on /dashboard with one tenant and no workspace picker.
 *   5. Roles: an invited Viewer is refused at CreateMissionDefinition, and an
 *      invited Editor passes that gate.
 *   6. A used link, an unknown link and an expired link reach "Invitation
 *      unavailable".
 *
 * Venue: the email is read from Mailpit (helpers/mailpit.ts), so the spec
 * runs where the signup suites run, on a kind venue with a mail sink. On a
 * venue without one it skips with a reason.
 *
 * Variables: E2E_ADMIN_* (helpers/accounts.ts), E2E_MAILPIT_URL, and
 * optionally E2E_INVITE_DOMAIN (the domain of the invited addresses) and
 * E2E_EXPIRED_INVITE_TOKEN (an invitation token that the orchestrator
 * expired).
 */

import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

import { BASE_URL } from "./helpers/accounts";
import { accept, firstSignIn, inviteNewPerson, postWithCsrf } from "./helpers/invite-flow";
import { requireMailpit } from "./helpers/mailpit";

test.describe("invite to first sign-in", () => {
  // Each test signs the admin in. Run them in order, so that two sign-ins of
  // the admin never share a TOTP window.
  test.describe.configure({ mode: "serial" });

  test("the accept link is on the product origin and reaches You're in", async ({ page, context }) => {
    test.setTimeout(240_000);
    const mailpitURL = requireMailpit();
    const invitee = await inviteNewPerson(page, context, mailpitURL, "Viewer");

    // hosted#203: the link must be on the origin the browser uses for the
    // dashboard. The API origin serves no /invite route.
    expect(invitee.acceptLink.origin).toBe(new URL(BASE_URL).origin);

    await context.clearCookies();
    await accept(page, invitee.acceptLink);

    // A used link is refused.
    await page.goto(invitee.acceptLink.toString());
    await expect(page.getByText("Invitation unavailable")).toBeVisible({ timeout: 30_000 });
  });

  test("an invited Viewer signs in to one tenant and is refused at CreateMissionDefinition", async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    const mailpitURL = requireMailpit();
    const invitee = await inviteNewPerson(page, context, mailpitURL, "Viewer");
    await context.clearCookies();
    const setupLink = await accept(page, invitee.acceptLink);
    await firstSignIn(page, context, invitee, setupLink);

    // One membership: the sign-in lands on the dashboard, with no picker.
    await expect(page).toHaveURL(/\/dashboard/);
    const perms = await page.request.get(`${BASE_URL}/api/auth/my-permissions`);
    expect(perms.status()).toBe(200);
    expect(((await perms.json()) as { isAdmin?: boolean }).isAdmin ?? false).toBe(false);

    // The demo route calls CreateMissionDefinition first. A Viewer is
    // refused there, so nothing is created and nothing runs.
    expect(await postWithCsrf(page, "/api/missions/demo")).toBe(403);
  });

  test("an invited Editor passes the CreateMissionDefinition gate", async ({ page, context }) => {
    test.setTimeout(300_000);
    const mailpitURL = requireMailpit();
    const invitee = await inviteNewPerson(page, context, mailpitURL, "Editor");
    await context.clearCookies();
    const setupLink = await accept(page, invitee.acceptLink);
    await firstSignIn(page, context, invitee, setupLink);

    await expect(page).toHaveURL(/\/dashboard/);
    const status = await postWithCsrf(page, "/api/missions/demo");
    expect(status, "an Editor was refused at CreateMissionDefinition").not.toBe(403);
    expect(status).not.toBe(401);
  });

  test("an unknown or expired link reaches Invitation unavailable", async ({ page }) => {
    await page.goto(`${BASE_URL}/invite/${randomBytes(24).toString("base64url")}`);
    await expect(page.getByText("Invitation unavailable")).toBeVisible({ timeout: 30_000 });

    const expired = process.env.E2E_EXPIRED_INVITE_TOKEN;
    test.skip(!expired, "E2E_EXPIRED_INVITE_TOKEN is not set, so the expired link is not checked");
    await page.goto(`${BASE_URL}/invite/${expired}`);
    await expect(page.getByText("Invitation unavailable")).toBeVisible({ timeout: 30_000 });
  });
});
