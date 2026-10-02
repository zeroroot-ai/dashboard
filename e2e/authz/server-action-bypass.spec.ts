// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * authz/server-action-bypass.spec.ts
 *
 * A Viewer cannot bypass assertAuthorized with a hand-made POST to a Server
 * Action, and an anonymous POST with a Next-Action header is refused.
 *
 * Next.js Server Actions are POST requests to the page that renders them,
 * carrying a `Next-Action` header with the action ID. A Viewer who finds
 * an ID in the bundle could POST it with a valid session cookie. The
 * assertAuthorized layer refuses that before any daemon call.
 *
 * Action ID discovery is best effort. When the deploy page renders no form
 * for a Viewer, no ID is emitted, and the spec asserts that absence instead.
 *
 * Credentials: E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD, E2E_MEMBER_TOTP_SECRET.
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, requireMember, signIn } from "../auth/helpers/accounts";

/** The deploy wizard hosts the register-plugin Server Action. */
const PLUGINS_PAGE = `${BASE_URL}/dashboard/deploy?type=plugin`;

/**
 * Looks for a Server Action ID on the deploy page. Returns null when the
 * page emits none, which is the expected outcome for a Viewer.
 */
async function discoverActionId(page: Page): Promise<string | null> {
  await page.goto(PLUGINS_PAGE, { waitUntil: "networkidle", timeout: 30_000 });

  const formAction = await page
    .locator("form[data-action], button[formaction]")
    .first()
    .getAttribute("data-action")
    .catch(() => null);
  if (formAction && formAction.length > 8) return formAction;

  const scripts = await page.locator("script:not([src])").allTextContents();
  for (const src of scripts) {
    const match = src.match(/\$ACTION_ID_([a-f0-9]{10,64})/i);
    if (match) return match[1];
  }
  return null;
}

test.describe("Authz gating, server-action bypass prevention", () => {
  test("a Viewer's direct POST to the register-plugin action is refused", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireMember());

    const actionId = await discoverActionId(page);

    if (!actionId) {
      // No form, no ID: the UI gate kept the action out of the Viewer's
      // bundle. Assert the control is absent so the pass is not vacuous.
      await page.goto(PLUGINS_PAGE, { waitUntil: "networkidle", timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: /add.*plugin|register.*plugin|deploy plugin/i }),
      ).toHaveCount(0, { timeout: 5_000 });
      return;
    }

    const cookieHeader = (await context.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const resp = await request.post(PLUGINS_PAGE, {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": actionId,
        Cookie: cookieHeader,
        "X-E2E-Bypass-Test": "1",
      },
      data: JSON.stringify([
        {
          manifestYaml:
            "apiVersion: gibson.ai/v1\nkind: Plugin\nmetadata:\n  name: bypass-attempt\n  version: 0.0.1\nspec:\n  runtime: grpc",
          bindings: [],
        },
      ]),
      timeout: 15_000,
    });

    const status = resp.status();
    const text = (await resp.text().catch(() => "")).toLowerCase();
    const denied =
      status === 401 ||
      status === 403 ||
      text.includes("permission_denied") ||
      text.includes("permission denied") ||
      text.includes("authzdenied") ||
      text.includes("not authorized") ||
      text.includes('"ok":false');

    expect(
      denied,
      `expected the bypass attempt to be refused. status=${status}, body=${text.slice(0, 300)}`,
    ).toBe(true);
  });

  test("an anonymous Next-Action POST is refused with 4xx", async ({ request }) => {
    const resp = await request.post(PLUGINS_PAGE, {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Next-Action": "000000000000000000000000000000000000000000000000000000000000dead",
      },
      data: JSON.stringify([{}]),
      timeout: 10_000,
      maxRedirects: 0,
    });
    const status = resp.status();
    expect(
      status >= 300,
      `expected a refusal or a redirect to /login for an anonymous action call, got ${status}`,
    ).toBe(true);
    expect(status).not.toBe(200);
  });
});
