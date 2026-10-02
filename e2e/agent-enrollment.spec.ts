// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * agent-enrollment.spec.ts
 *
 * The dashboard half of agent enrollment: an admin registers an agent on
 * /dashboard/agents/register, the credential panel shows a bootstrap token
 * and an enroll command, and the agent appears in the agents list.
 *
 * The spec writes to the e2e tenant on staging: one agent per run, named
 * `e2e-<timestamp>-<random>`. The enroll command carries the bootstrap
 * token, which this spec never prints.
 *
 * Gates:
 *   E2E_CLUSTER_AVAILABLE=1   a live platform is reachable at PLAYWRIGHT_BASE_URL
 *   E2E_ADMIN_*               the admin account (helpers/accounts.ts)
 */

import { test, expect } from "@playwright/test";
import * as crypto from "node:crypto";
import { BASE_URL, requireAdmin, signIn } from "./auth/helpers/accounts";

const needsCluster = !process.env.E2E_CLUSTER_AVAILABLE;

test.describe("agent enrollment, integration (live platform)", () => {
  test.skip(needsCluster, "requires a live platform and E2E_CLUSTER_AVAILABLE=1");

  test("register an agent via the dashboard, then it appears in the agents list", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await signIn(page, context, requireAdmin());

    const agentName =
      "e2e-" + Date.now().toString(36) + "-" + crypto.randomBytes(2).toString("hex");

    await test.step("register the agent through the form", async () => {
      await page.goto(`${BASE_URL}/dashboard/agents/register`);
      const nameInput = page.locator("#register-agent-name");
      await expect(nameInput).toBeVisible({ timeout: 20_000 });
      await nameInput.fill(agentName);
      await page.getByRole("button", { name: /^register agent$/i }).click();

      // The credential panel: a bootstrap token and the enroll command.
      const token = page.locator("#register-agent-bootstrap-token");
      await expect(token).toBeVisible({ timeout: 30_000 });
      expect((await token.inputValue()).length).toBeGreaterThan(0);

      const enroll = page.locator("#register-agent-enroll-command");
      await expect(enroll).toBeVisible({ timeout: 5_000 });
      expect(await enroll.inputValue()).toContain("gibson");
    });

    await test.step("the agent appears in the agents list", async () => {
      await page.goto(`${BASE_URL}/dashboard/agents`);
      await expect(page.getByText(agentName, { exact: false }).first()).toBeVisible({
        timeout: 30_000,
      });
    });
  });
});
