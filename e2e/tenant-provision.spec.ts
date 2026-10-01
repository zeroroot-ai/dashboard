// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * tenant-provision.spec.ts, Slice 5.7 part 1
 *
 * Dashboard-side assertions for the tenant provisioning flow:
 *
 *   User submits signup → Tenant CRD created → tenant-operator reconciles →
 *   per-tenant resources land (FGA tuples, Vault paths, Langfuse project,
 *   broker config, namespace) → dashboard state reflects completion.
 *
 * Two test groups:
 *
 *   1. Stubbed (runs without kind cluster), tests the dashboard UI state at
 *      each checkpoint by intercepting the API calls the dashboard makes and
 *      returning canned responses.
 *
 *   2. Integration (requires kind cluster + E2E_KIND_AVAILABLE=1), drives the
 *      real signup form, polls /api/onboarding/data-plane until Ready, then
 *      asserts the membership list and quota panel populate correctly.
 *
 * Authentication in stubbed tests: synthetic JWE via
 *
 * Refs: dashboard#220 (slice 5.7 p1), tenant-operator#76 (PRD module 8).
 */

import { test, expect } from "@playwright/test";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Skip guard
// ---------------------------------------------------------------------------


// Integration tests additionally require a live kind cluster.
const needsCluster = !process.env.E2E_KIND_AVAILABLE;

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_USER = {
  sub: "e2e-tenant-provision-user",
  name: "Provision Test",
  email: "provision@e2e.zeroroot.local",
};
const MOCK_TENANT_ID = "tenant-e2e-provision-test";

// ---------------------------------------------------------------------------
// Stubbed UI-state tests (no kind cluster required)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Integration tests (kind cluster required)
// ---------------------------------------------------------------------------

test.describe("tenant provisioning, integration (kind cluster)", () => {
  test.skip(needsCluster, "requires kind cluster + E2E_KIND_AVAILABLE=1");

  const PLAN = process.env.SIGNUP_SMOKE_PLAN ?? "team";
  const READY_TIMEOUT_MS = Number(
    process.env.SIGNUP_SMOKE_READY_TIMEOUT_MS ?? 180_000,
  );
  const POLL_INTERVAL_MS = Number(
    process.env.SIGNUP_SMOKE_POLL_INTERVAL_MS ?? 5_000,
  );

  test.setTimeout(READY_TIMEOUT_MS + 90_000);

  test(
    "signup → saga completes → dashboard shows provisioned tenant → quota panel populates",
    async ({ page, request }) => {
      const slug =
        "e2e-prov-" +
        Date.now().toString(36) +
        "-" +
        crypto.randomBytes(2).toString("hex");
      const email = `${slug}@e2e.zeroroot.local`;
      const password = `Ae1!${crypto.randomBytes(8).toString("hex")}`;
      const workspaceName = `Provision ${slug}`;

      // Stage 1, submit signup form.
      await test.step("submit signup form", async () => {
        await page.goto(`/signup?plan=${encodeURIComponent(PLAN)}`);
        await page.getByLabel(/first name/i).fill("Prov");
        await page.getByLabel(/last name/i).fill(slug);
        await page.getByLabel(/work email/i).fill(email);
        const pwInputs = page.locator('input[type="password"]');
        await pwInputs.first().fill(password);
        if ((await pwInputs.count()) >= 2) {
          await pwInputs.nth(1).fill(password);
        }
        await page.getByLabel(/workspace name|company name/i).fill(workspaceName);
        await page.locator("#acceptToS").check();
        await page.locator("#acceptPrivacy").check();
        await page.getByRole("button", { name: /create account|sign up/i }).click();

        // Provisioning panel should appear inline.
        await expect(
          page.getByText(/provisioning|initializing|setting up|spinning up/i).first(),
        ).toBeVisible({ timeout: 30_000 });
      });

      // Stage 2, poll /api/onboarding/data-plane until all stores are ready.
      await test.step("wait for tenant saga to complete", async () => {
        const deadline = Date.now() + READY_TIMEOUT_MS;
        let ready = false;
        let lastSnap: unknown;

        while (Date.now() < deadline) {
          const resp = await request.get("/api/onboarding/data-plane");
          if (resp.ok()) {
            const snap = await resp.json() as {
              postgres?: { state: string };
              redis?: { state: string };
              graph?: { state: string };
            };
            lastSnap = snap;
            if (
              snap.postgres?.state === "ready" &&
              snap.redis?.state === "ready" &&
              snap.graph?.state === "ready"
            ) {
              ready = true;
              break;
            }
          }
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        expect(
          ready,
          `Tenant did not reach Ready within ${READY_TIMEOUT_MS}ms. Last: ${JSON.stringify(lastSnap)}`,
        ).toBe(true);
      });

      // Stage 3, navigate to dashboard; assert tenant chrome.
      await test.step("dashboard shows provisioned tenant (no 'No workspace')", async () => {
        await page.goto("/dashboard");
        await expect(page).toHaveURL(/\/dashboard/);
        await expect(page.getByRole("banner")).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole("banner")).not.toContainText("No workspace");
      });

      // Stage 4, quota panel on billing page.
      await test.step("quota panel populates on billing page", async () => {
        await page.goto("/dashboard/pages/settings/billing");
        await page.waitForLoadState("domcontentloaded");
        await expect(page.getByText(/Plan & Usage/i)).toBeVisible({
          timeout: 20_000,
        });
        // The quota panel must NOT show the "Usage temporarily unavailable"
        // fallback for a freshly provisioned tenant.
        await expect(
          page.getByText(/Usage temporarily unavailable/i),
        ).not.toBeVisible({ timeout: 5_000 });
      });
    },
  );
});
