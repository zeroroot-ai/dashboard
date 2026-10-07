// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * invite-flow.ts, the steps of the invite flow that the invite spec and the
 * quickstart screenshot task share (dashboard#149).
 */

import { randomBytes } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";

import { BASE_URL, requireAdmin, signIn } from "./accounts";
import { completeAccountSetup } from "./account-setup";
import { waitForLink } from "./mailpit";

const INVITE_DOMAIN = process.env.E2E_INVITE_DOMAIN ?? "e2e.invalid";

export type InvitedRole = "Viewer" | "Editor";

export interface Invitee {
  email: string;
  password: string;
  acceptLink: URL;
}

/** Hooks that the screenshot task uses to capture a step. */
export interface InviteHooks {
  roleListOpen?: (page: Page) => Promise<void>;
  invitedRow?: (page: Page) => Promise<void>;
}

export function newAddress(role: InvitedRole): string {
  return `e2e-invite-${role.toLowerCase()}-${Date.now()}-${randomBytes(3).toString("hex")}@${INVITE_DOMAIN}`;
}

/** A password that meets the Zitadel complexity policy. It is never logged. */
export function newPassword(): string {
  return `Aa1!${randomBytes(18).toString("base64url")}`;
}

/** The signed-in admin opens the users page and invites `email` with `role`. */
export async function invite(page: Page, email: string, role: InvitedRole, hooks: InviteHooks = {}): Promise<void> {
  await page.goto(`${BASE_URL}/dashboard/organization/users`);
  await page.getByRole("button", { name: /invite user|invite your first user/i }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Invite User")).toBeVisible();
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: role })).toBeVisible();
  await hooks.roleListOpen?.(page);
  await page.getByRole("option", { name: role }).click();
  await dialog.getByRole("button", { name: /send invitation/i }).click();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: email })).toBeVisible({
    timeout: 20_000,
  });
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("Invited")).toBeVisible();
  await hooks.invitedRow?.(page);
}

/** The accept link of the invitation email to `email`. */
export async function acceptLinkFor(mailpitURL: string, email: string): Promise<URL> {
  return waitForLink(mailpitURL, email, (url) => /^\/invite\/[^/]+$/.test(url.pathname));
}

/** Signs the admin in, invites a new address with `role`, and returns its accept link. */
export async function inviteNewPerson(
  page: Page,
  context: BrowserContext,
  mailpitURL: string,
  role: InvitedRole,
  hooks: InviteHooks = {},
): Promise<Invitee> {
  await signIn(page, context, requireAdmin());
  const email = newAddress(role);
  await invite(page, email, role, hooks);
  return { email, password: newPassword(), acceptLink: await acceptLinkFor(mailpitURL, email) };
}

/** Opens the accept link and returns the one-time setup link it hands over. */
export async function accept(page: Page, link: URL): Promise<string> {
  await page.goto(link.toString());
  await expect(page.getByText("You're in")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Your membership is active.")).toBeVisible();
  const setup = page.getByRole("link", { name: "Set your password" });
  await expect(setup).toBeVisible();
  const href = await setup.getAttribute("href");
  expect(href, "the accept page handed over no setup link").toBeTruthy();
  return href as string;
}

/** Completes the account setup and signs the invitee in for the first time. */
export async function firstSignIn(
  page: Page,
  context: BrowserContext,
  invitee: Invitee,
  setupLink: string,
): Promise<string> {
  const totpSecret = await completeAccountSetup(page, setupLink, invitee.email, invitee.password);
  await context.clearCookies();
  await signIn(page, context, { email: invitee.email, password: invitee.password, totpSecret });
  return totpSecret;
}

/**
 * POSTs to a dashboard route from the signed-in page, with the CSRF header
 * that apiFetch sets (src/lib/api/fetch.ts). Returns the HTTP status.
 */
export async function postWithCsrf(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    let token = "";
    for (const name of ["__Host-csrf-token", "csrf-token"]) {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
      if (m) {
        token = decodeURIComponent(m[1]);
        break;
      }
    }
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-csrf-token": token },
      body: "{}",
    });
    return res.status;
  }, path);
}
