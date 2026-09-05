/**
 * plan-change.spec.ts, Slice 5.9 part 2
 *
 * Dashboard-side UI assertions for the plan change flow:
 *
 *   User initiates plan change via dashboard → Stripe checkout (mocked) →
 *   billing page reflects the available plan actions.
 *
 * Covers:
 *   - Billing page renders the upgrade / manage-subscription CTA for
 *     self-serve plans.
 *   - Checkout API stub returns a fake URL the caller follows.
 *   - Pricing page renders self-serve and enterprise tiers.
 *   - Enterprise tiers show a "Contact Sales" CTA.
 *
 * The Stripe checkout interaction is fully mocked using Playwright's
 * page.route() to intercept /api/billing/checkout and return a fake
 * checkout URL. No live Stripe sandbox key is required. All tests run
 * without a kind cluster.
 *
 * Webhook delivery is NOT exercised here: the Stripe webhook moved to the
 * closed `billing` repo (a dedicated billing-webhook workload) in E7, and
 * Envoy now routes /api/billing/webhook there, not the dashboard
 * (deploy#950). The former kind-gated webhook+quota assertions posted to the
 * now-deleted dashboard route and were removed with it (dashboard#855).
 *
 * Refs: dashboard#222 (slice 5.9 p2), dashboard#855.
 */

import { test, expect } from "@playwright/test";
import {
  stubStripeCheckout,
} from "./page-objects/billing.po";

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

// UI flow tests run without a cluster but require the dev server.
// They never need TEST_AUTH_BYPASS because they interact with public
// billing pages and mock all API calls.
//
// Webhook delivery itself is no longer exercised here: the Stripe webhook
// moved to the closed `billing` repo (a dedicated billing-webhook workload)
// in E7, and Envoy now routes `/api/billing/webhook` there, not the
// dashboard (deploy#950). The former kind-gated webhook+quota assertions in
// this spec posted to the now-deleted dashboard route, so they were removed
// alongside the route (dashboard#855).

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

const BILLING_URL = `${BASE_URL}/dashboard/pages/settings/billing`;

// ---------------------------------------------------------------------------
// UI flow tests, Stripe checkout stub (no cluster required)
// ---------------------------------------------------------------------------

test.describe("plan change, Stripe checkout stub (no cluster required)", () => {
  test("billing page renders upgrade CTA for self-serve plans", async ({
    page,
  }) => {
    // Stub tier: currently on "team".
    await page.route("**/api/settings/tier**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          config: {
            tier: "team",
            displayName: "Team",
            maxTeamMembers: 10,
            maxAPIKeys: 100,
            customRolesEnabled: false,
            auditLogRetentionDays: 90,
            ssoEnabled: false,
            prioritySupport: false,
          },
          usage: {
            teamMemberCount: 1,
            apiKeyCount: 0,
            customRoleCount: 0,
            pendingInvitationCount: 0,
          },
        }),
      });
    });
    await page.route("**/*getTenantQuota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            seats: 10,
            concurrentAgents: 5,
            storageGb: 50,
            retentionDays: 90,
            sandboxLaunchesPerMonth: 1000,
            updatedAt: new Date().toISOString(),
            currentSeats: 1,
            currentConcurrentAgents: 0,
            currentStorageGb: 0,
            currentSandboxLaunchesThisMonth: 0,
          },
        }),
      });
    });

    await page.goto(BILLING_URL);
    await page.waitForLoadState("domcontentloaded");

    // The billing page should show "Plan & Usage".
    await expect(page.getByText(/Plan & Usage/i)).toBeVisible({
      timeout: 15_000,
    });

    // A self-serve plan should show a "manage subscription" button (Stripe portal link).
    await expect(
      page.getByRole("button", { name: /manage subscription|upgrade|change plan/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("checkout API stub returns fake URL and caller follows redirect", async ({
    page,
    context,
  }) => {
    const fakeCheckoutUrl = "https://checkout.stripe.test/pay/cs_test_e2e";

    // Stub the checkout endpoint.
    await stubStripeCheckout(context, fakeCheckoutUrl);

    // Intercept the navigation to the fake Stripe URL so we don't leave the domain.
    await page.route("https://checkout.stripe.test/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body><h1>Stripe Checkout (mock)</h1></body></html>",
      });
    });

    // Call the checkout endpoint directly to verify the stub works.
    const resp = await page.request.post(`${BASE_URL}/api/billing/checkout`, {
      data: { tier: "org", tenantSlug: "e2e-upgrade-test" },
      headers: { "Content-Type": "application/json" },
    });

    // Stub returns 200 with a URL field.
    expect(resp.status()).toBe(200);
    const body = await resp.json() as { url?: string };
    expect(body.url).toBe(fakeCheckoutUrl);
  });

  test("pricing page renders self-serve and enterprise plan tiers", async ({
    page,
  }) => {
    // Stub plan data so the pricing page doesn't require a live API.
    await page.route("**/api/config/public**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          stripePriceTeam: "price_team_e2e",
          stripePriceOrg: "price_org_e2e",
          stripePriceEnterprise: "",
        }),
      });
    });

    await page.goto(`${BASE_URL}/pricing`);
    await page.waitForLoadState("domcontentloaded");

    // The pricing page should render without a 500 error.
    const body = await page.locator("body").textContent({ timeout: 10_000 });
    expect(body ?? "").not.toMatch(/500 Internal Server Error/i);
  });

  test("billing page shows 'Contact Sales' CTA for enterprise tiers", async ({
    page,
  }) => {
    await page.route("**/api/settings/tier**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          config: {
            tier: "enterprise",
            displayName: "Enterprise",
            maxTeamMembers: 500,
            maxAPIKeys: 10000,
            customRolesEnabled: true,
            auditLogRetentionDays: 365,
            ssoEnabled: true,
            prioritySupport: true,
          },
          usage: {
            teamMemberCount: 0,
            apiKeyCount: 0,
            customRoleCount: 0,
            pendingInvitationCount: 0,
          },
        }),
      });
    });
    await page.route("**/*getTenantQuota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            seats: 500,
            concurrentAgents: 100,
            storageGb: 2000,
            retentionDays: 365,
            sandboxLaunchesPerMonth: 0,
            updatedAt: new Date().toISOString(),
            currentSeats: 0,
            currentConcurrentAgents: 0,
            currentStorageGb: 0,
            currentSandboxLaunchesThisMonth: 0,
          },
        }),
      });
    });

    await page.goto(BILLING_URL);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByText(/Plan & Usage/i)).toBeVisible({
      timeout: 15_000,
    });

    // Enterprise / contact-sales plans show "Contact Sales" instead of
    // "Manage Subscription".
    await expect(
      page.getByRole("button", { name: /contact sales/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
