/**
 * signup-happy-path.spec.ts
 *
 * End-to-end exercise of the Envoy-routed admin channel
 * (spec `dashboard-admin-via-envoy`, Req 7).
 *
 * Distinct from `signup-happy.spec.ts`:
 *   - Entry point is `/pricing` (not `/signup`) to prove the cross-page
 *     wiring works.
 *   - The assertion focus is the **provisioning progress transitions** —
 *     each transition is powered by an admin RPC that now routes through
 *     Envoy with a SPIFFE JWT-SVID. If the admin channel is broken, the
 *     provisioning page stalls and this test fails with a clear signal
 *     (we know WHICH step didn't happen).
 *   - On arrival at `/dashboard` we hit `/api/auth/session` to confirm the
 *     session carries a real tenant — proves the end-to-end effect of the
 *     admin RPCs (quota upserted, FGA tuples written, catalog seeded).
 *
 * Pre-conditions:
 *   - Full chart deployed to the `gibson` Kind cluster
 *     (`make -C enterprise/deploy/helm/gibson deploy-local`).
 *   - `DASHBOARD_EMAIL_PROVIDER=log`, `DASHBOARD_CAPTCHA_PROVIDER=disabled`.
 *   - `BILLING_DEV_AUTOCONFIRM` either flipped on OR Stripe webhook reachable.
 *
 * Cleanup:
 *   After the test, the Tenant CR is deleted via `kubectl` so re-runs stay
 *   idempotent. If `kubectl` isn't available the cleanup is logged and
 *   skipped — the test itself does not fail on cleanup issues.
 */

import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";

/**
 * Each provisioning step surfaces a short terminal-style string in the
 * UI. The exact copy lives in the progress panel component; matching
 * with a regex keeps this resilient to tone-of-voice tweaks while still
 * proving the underlying step actually advanced.
 */
const STEP_COPY = {
  provisioning: /provisioning control plane/i,
  granting: /granting root/i,
  done: /access granted|welcome/i,
} as const;

/** Convenience: wait for a piece of text to appear, with a clear failure msg. */
async function waitForText(
  page: Page,
  pattern: RegExp,
  label: string,
  timeoutMs: number,
): Promise<void> {
  await expect(page.getByText(pattern).first(), {
    message: `Provisioning step "${label}" never appeared — admin channel may be broken.`,
  }).toBeVisible({ timeout: timeoutMs });
}

test.describe("Signup happy path — pricing → dashboard via Envoy admin channel", () => {
  test("provisioning transitions complete and session carries a tenant", async ({
    page,
    request,
  }) => {
    const creds = generateUserCredentials();

    // -----------------------------------------------------------------------
    // 1. Enter from /pricing and click the Squad tier CTA.
    // -----------------------------------------------------------------------
    await page.goto(`${BASE_URL}/pricing`);
    await expect(page).toHaveURL(/\/pricing/, { timeout: 15_000 });

    const squadCta = page
      .getByRole("link", { name: /squad/i })
      .or(page.getByRole("button", { name: /squad/i }))
      .first();
    await squadCta.click();

    // The /pricing → /signup wiring should include `?plan=squad`.
    await page.waitForURL(/\/signup(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/plan=squad/);

    // -----------------------------------------------------------------------
    // 2. Fill signup form with a unique email.
    // -----------------------------------------------------------------------
    await page
      .getByLabel(/company name/i)
      .or(page.getByPlaceholder(/company|organization|workspace/i))
      .first()
      .fill(creds.companyName);

    await page.getByLabel(/email/i).fill(creds.email);

    const passwordFields = page.getByLabel(/^password$/i);
    await passwordFields.first().fill(creds.password);

    const confirmField = page
      .getByLabel(/confirm password|re-enter password/i)
      .first();
    if ((await confirmField.count()) > 0) {
      await confirmField.fill(creds.password);
    }

    const tosCheckbox = page
      .getByRole("checkbox", { name: /terms|tos|agree/i })
      .first();
    if ((await tosCheckbox.count()) > 0) {
      await tosCheckbox.check();
    }

    await page
      .getByRole("button", { name: /create account|sign up|get started/i })
      .first()
      .click();

    // -----------------------------------------------------------------------
    // 3. Observe provisioning progress transitions.
    //
    // Each `waitForText` is a claim about a specific admin RPC:
    //   provisioning → the tenant CR was created + the operator kicked off
    //   granting     → DaemonAdmin.UpsertTenantQuota + FGA tuple writes ran
    //   done         → entitlements finalised, session ready
    //
    // 30 s budget total for the chain — the steady-state signup on Kind is
    // ~8-12 s. More than 30 s means a step stalled.
    // -----------------------------------------------------------------------
    await waitForText(page, STEP_COPY.provisioning, "provisioning", 15_000);
    await waitForText(page, STEP_COPY.granting, "granting", 20_000);
    await waitForText(page, STEP_COPY.done, "done", 25_000);

    // -----------------------------------------------------------------------
    // 4. Land on /dashboard and confirm the session has a tenant.
    // -----------------------------------------------------------------------
    await page.waitForURL((url) => url.pathname.startsWith("/dashboard"), {
      timeout: 30_000,
    });
    await expect(page).toHaveURL(/\/dashboard/);

    // Hit the Auth.js session endpoint. This is also what the browser uses
    // to populate `useSession()`, so if it's empty the UI is broken too.
    const sessionResp = await request.get(
      `${BASE_URL}/api/auth/session`,
      { headers: { cookie: (await page.context().cookies())
          .map((c) => `${c.name}=${c.value}`)
          .join("; ") } },
    );
    expect(sessionResp.ok()).toBe(true);

    const session = (await sessionResp.json()) as {
      user?: { tenantId?: string; tenant?: { id?: string } };
    };
    const tenantId =
      session.user?.tenantId ?? session.user?.tenant?.id ?? null;
    expect(
      tenantId,
      "session.user.tenantId must be populated — admin channel did not write entitlements",
    ).toBeTruthy();

    // -----------------------------------------------------------------------
    // 5. Cleanup — best-effort. We don't fail the test on cleanup issues.
    // -----------------------------------------------------------------------
    try {
      execSync(
        `kubectl delete tenant.gibson.zero-day.ai ${creds.slug} --ignore-not-found`,
        { stdio: "pipe", timeout: 10_000 },
      );
    } catch (err) {
      console.warn(
        `signup-happy-path: cleanup of tenant ${creds.slug} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  });
});
