/**
 * Signup end-to-end smoke (tenant-operator#76 PRD Module 8).
 *
 * Drives the dashboard's `/signup?plan=team` form against a live cluster
 * (kind dev by default; production-like overlays via env), then polls
 * the dashboard's onboarding-data-plane endpoint until the Tenant CR
 * the saga creates reaches `Ready: True`. Asserts the full 13-step
 * provisioning saga (Namespace → Langfuse → Stripe → BillingPending →
 * Zitadel → FGA → SecretsBackend → Redis → TenantName → Neo4jScope →
 * DataPlane → Entitlements → CatalogSeeded → Ready) completes within
 * 180 seconds.
 *
 * Why: every "fix the signup" session this far has been triggered by
 * `PROVISIONING_TIMEOUT` on the dashboard with no signal pointing at
 * which subsystem boundary actually broke. With this spec wired as a
 * required check on every PR touching `deploy / gitops / gibson /
 * tenant-operator / dashboard / sdk`, the 10-bug cascade pattern
 * cannot recur from the same root causes, any regression at any
 * layer turns the green PR check red BEFORE merge, not 4 hours of
 * log archaeology after the fact.
 *
 * Run against kind locally:
 *   PLAYWRIGHT_BASE_URL=https://app.zeroroot.local:30443 \
 *     SIGNUP_SMOKE_PLAN=team \
 *     pnpm playwright test e2e/signup-smoke.spec.ts
 *
 * The CI runner uses .github/workflows/kind-up-smoke.yml in the deploy
 * repo to set up a fresh kind cluster + Argo App-of-Apps before invoking
 * this spec.
 */
import { randomBytes } from 'node:crypto';

import { test, expect, type Frame, type Page } from '@playwright/test';
import { loginViaZitadelV2 } from './auth/helpers/login-via-zitadel-v2';

/**
 * Resolve the Stripe.js frame that owns a given input.
 *
 * The Payment Element splits card number / expiry / cvc / postal across
 * SEPARATE `__privateStripeFrame` iframes, and which index holds which field
 * is not stable — it shifts with the accordion (Link, Bank, Cash App, Klarna
 * and friends each mount their own frame). Targeting `.first()` lands on
 * whichever frame happened to mount first, typically Link's phone/email form,
 * and silently types the card number into the wrong field. Resolve by the
 * input the frame actually contains instead.
 */
async function stripeFrameWith(page: Page, selector: string, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const f of page.frames()) {
      if (await f.locator(selector).count().catch(() => 0)) return f;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`no Stripe frame exposing ${selector} appeared within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Test config, env-driven so the same spec runs against kind and any
// other cluster overlay without code changes.
// ---------------------------------------------------------------------------

const PLAN = process.env.SIGNUP_SMOKE_PLAN ?? 'team';
const READY_TIMEOUT_MS = Number(process.env.SIGNUP_SMOKE_READY_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = Number(process.env.SIGNUP_SMOKE_POLL_INTERVAL_MS ?? 5_000);

// Unique-per-run tenant slug. Avoids cross-run collisions when multiple
// PRs in CI race against the same long-lived cluster (the dev cluster is
// reused; the CI cluster is fresh each run but the prefix is fine either
// way).
function fixtureSlug() {
  const t = Date.now().toString(36);
  // randomBytes, not Math.random. The slug is not only a collision-avoidance
  // suffix: the test derives this run's account password from it a few lines
  // below. Math.random is seeded predictably enough that anyone able to
  // observe a slug (they appear in tenant names and email addresses on the
  // shared dev cluster) could recover the password of the account this run
  // creates. Cryptographic randomness costs nothing here and removes the
  // question entirely.
  const r = randomBytes(4).toString('hex');
  return `e2e-${t}-${r}`;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe('signup smoke', () => {
  test.setTimeout(READY_TIMEOUT_MS + 60_000);

  test('completes 13-step saga end-to-end and reaches Ready: True', async ({ page, request }) => {
    const slug = fixtureSlug();
    const email = `${slug}@e2e.zeroroot.local`;
    const password = 'CorrectHorseBatteryStaple-' + slug;
    const workspaceName = `Smoke ${slug}`;

    // Stage 1, submit the signup form. The dashboard's Server Action
    // creates the Zitadel user, fires the OIDC code-exchange round-trip,
    // and (on success) creates the Tenant CR. We end up on the
    // provisioning page where the dashboard polls /api/onboarding/data-plane
    // until the operator reports Ready.
    await test.step('submit signup form', async () => {
      await page.goto(`/signup?plan=${encodeURIComponent(PLAN)}`);

      // The acceptToS / acceptPrivacy fields render as Radix Checkbox
      // components, which do NOT expose a native `<input name="...">`
      // element, they use a button[role=checkbox] with the field name
      // surfaced only via the wrapping form. Selectors must therefore
      // target the checkbox by `#acceptToS` / `#acceptPrivacy` (the form
      // sets these as ids on the rendered control), matching the
      // working pattern in e2e/auth/helpers/signup-via-form.ts.
      //
      // The text-field selectors use getByLabel so they tolerate any
      // future tweak to the underlying input markup (shadcn often wraps
      // inputs in their own element tree).
      await page.getByLabel(/first name/i).fill('Ada');
      await page.getByLabel(/last name/i).fill(slug);
      await page.getByLabel(/work email/i).fill(email);
      const pwInputs = page.locator('input[type="password"]');
      await pwInputs.first().fill(password);
      if ((await pwInputs.count()) >= 2) {
        await pwInputs.nth(1).fill(password);
      } else {
        await page.getByLabel(/confirm password/i).fill(password);
      }
      await page.getByLabel(/workspace name|company name/i).fill(workspaceName);
      // Stage 1b (card-first signup, dashboard#769 / #981). When paid tiers
      // are enabled the Stripe Payment Element renders INLINE on /signup,
      // above the consent checkboxes, and "Create account" stays DISABLED
      // until the card is complete — there is no post-submit await_payment
      // panel to drive. Submitting first therefore clicks a permanently
      // disabled button. Gate: SIGNUP_SMOKE_PAID=1 (kind's card-free
      // self-hosted profile renders no element at all).
      if (process.env.SIGNUP_SMOKE_PAID === '1') {
        const numberFrame = await stripeFrameWith(page, 'input[name="number"]');
        await numberFrame.locator('input[name="number"]').fill('4242424242424242');

        const expiryFrame = await stripeFrameWith(page, 'input[name="expiry"]');
        await expiryFrame.locator('input[name="expiry"]').fill('12 / 34');

        const cvcFrame = await stripeFrameWith(page, 'input[name="cvc"]');
        await cvcFrame.locator('input[name="cvc"]').fill('123');

        // Postal is present for US cards and absent for some others.
        for (const f of page.frames()) {
          const zip = f.locator('input[name="postalCode"]');
          if (await zip.count().catch(() => 0)) {
            await zip.fill('42424').catch(() => undefined);
            break;
          }
        }
      }

      await page.locator('#acceptToS').check();
      await page.locator('#acceptPrivacy').check();

      const submit = page.getByRole('button', { name: /create account|sign up/i });
      // Assert enablement explicitly: a disabled submit here means the card
      // never completed, and Playwright's auto-retry would otherwise burn the
      // whole timeout clicking a dead button with no useful failure message.
      await expect(submit).toBeEnabled({ timeout: 30_000 });
      await submit.click();

      // The ProvisioningPanel renders IN-PAGE; the URL stays
      // /signup?plan=<plan> until the panel finishes its
      // /api/signup/progress/:id polling and then calls
      // window.location.assign(redirectOnSuccess), which lands at
      // /login?callbackUrl=/dashboard (or /api/auth/callback/zitadel?...
      // when auto-login completes the parked auth_request, which then
      // bounces to /dashboard).
      //
      // We assert the panel actually appeared. Stage 2 then takes over
      // the long wait via /api/onboarding/data-plane polling.
      await expect(
        page.getByText(/provisioning|initializing|setting up|spinning up/i).first(),
      ).toBeVisible({ timeout: 30_000 });
    });

    // Stage 2, poll until the operator reports the tenant provisioned.
    //
    // Uses /api/signup/status?tenant=<slug>, NOT /api/onboarding/data-plane
    // (dashboard#981). The data-plane endpoint is session-scoped: the signup
    // flow does not leave this browser context with a resolvable session, so
    // every poll returned 412 and the loop burned its whole budget reporting
    // `Last data-plane snapshot: undefined` — while the Tenant CR had in fact
    // reached Ready. signup-status is the same public signal
    // scripts/smoke-signup.sh asserts, and it needs no session.
    const tenantSlug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // /api/signup/status returns { status, currentStep, steps[] }. status is
    // "active" once the operator's saga has taken the tenant to Ready;
    // "failed" is terminal.
    interface SignupStatus {
      status: 'pending' | 'provisioning' | 'active' | 'failed' | string;
      currentStep?: string;
      steps?: Array<{ name: string; status: string }>;
    }

    let lastSnapshot: SignupStatus | undefined;
    const deadline = Date.now() + READY_TIMEOUT_MS;
    let ready = false;

    while (Date.now() < deadline) {
      const resp = await request.get(
        `/api/signup/status?tenant=${encodeURIComponent(tenantSlug)}`,
      );
      if (resp.ok()) {
        const snapshot = (await resp.json()) as SignupStatus;
        lastSnapshot = snapshot;
        if (snapshot.status === 'active') {
          ready = true;
          break;
        }
        // Bail early on permanent failure surfaced by the operator.
        if (snapshot.status === 'failed') {
          throw new Error(
            `Tenant ${tenantSlug} provisioning failed: ${JSON.stringify(snapshot)}`,
          );
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (!ready) {
      throw new Error(
        `Tenant ${tenantSlug} did not reach Ready: True within ${READY_TIMEOUT_MS}ms. ` +
          `Last signup-status snapshot: ${JSON.stringify(lastSnapshot, null, 2)}`,
      );
    }

    // Stage 3, the new user can actually sign in and land in their tenant.
    //
    // Post-signup the product returns to /login?callbackUrl=%2Fdashboard —
    // POST_SIGNUP_REDIRECT in app/actions/signup.ts. Auto-login was retired in
    // E9 (dashboard#812), so the previous `goto('/dashboard')` assertion could
    // only ever have passed against a session this flow no longer establishes;
    // it redirected straight back to /login (dashboard#981).
    //
    // Assert the redirect contract, then complete the sign-in for real via the
    // canonical Zitadel helper. Signing in is the point: it is what proves the
    // saga's Zitadel user + FGA membership actually landed, which a URL
    // assertion alone does not.
    await test.step('post-signup lands on /login carrying the dashboard callback', async () => {
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
      expect(decodeURIComponent(page.url())).toContain('callbackUrl=/dashboard');
    });

    await test.step('new user signs in and reaches their tenant', async () => {
      await loginViaZitadelV2(page, page.context(), {
        email,
        password,
        baseURL: process.env.PLAYWRIGHT_BASE_URL ?? undefined,
      });

      await page.goto('/dashboard');
      // Not /onboarding: that would mean the saga finished but the FGA
      // membership tuples never propagated — a real regression class.
      await expect(page).not.toHaveURL(/\/onboarding/);
      await expect(page).toHaveURL(/\/dashboard/);
    });
  });
});
