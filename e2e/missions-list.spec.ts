// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * missions-list.spec.ts
 *
 * The tenant-scoped data hooks (useMissions, useFindings, useAlerts, ...)
 * read `useTenantStore((s) => s.currentTenant)?.id` and gate React Query on
 * it. Before this spec the store shim returned null because it read dead
 * session claims, so the missions list never fetched.
 *
 * The spec signs in and asserts that the Mission Results page fires at
 * least one request to a missions endpoint. That proves `currentTenant?.id`
 * was non-null on first render.
 *
 * Credentials: E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_ADMIN_TOTP_SECRET.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, requireAdmin, signIn } from "./auth/helpers/accounts";

test.describe("Missions list fires tenant-scoped queries", () => {
  test("a missions request is made when the results page mounts", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, context, requireAdmin());

    // Arm the listener before the navigation so the request is not missed.
    const missionsRequest = page.waitForRequest(
      (req) => /\/api\/missions(\?|\/|$)/.test(req.url()),
      { timeout: 20_000 },
    );

    // The runs list lives under Mission Results (dashboard#497).
    await page.goto(`${BASE_URL}/dashboard/results`);

    await expect(missionsRequest).resolves.toBeTruthy();
  });
});
