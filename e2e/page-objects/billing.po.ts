/**
 * billing.po.ts — Billing page-object helpers.
 *
 * Reusable helpers for:
 * - Crafting Stripe webhook payloads with a valid HMAC signature using a
 *   test-only secret (does NOT require a live Stripe sandbox key).
 * - Stubbing the Stripe checkout flow via Playwright network interception.
 * - Asserting quota / plan state on the billing settings page.
 *
 * The webhook signing uses the same algorithm Stripe uses (HMAC-SHA256 over
 * "t=<timestamp>.<version>=<payload>") so the dashboard's verifyWebhookSignature
 * helper accepts the synthesized events. In tests, STRIPE_WEBHOOK_SECRET must
 * be set to STRIPE_WEBHOOK_TEST_SECRET (the same constant defined below) for
 * the route to accept test events.
 */

import * as crypto from "crypto";
import type { BrowserContext, Page } from "@playwright/test";

/**
 * Test-only STRIPE_WEBHOOK_SECRET. The billing-webhook.spec and plan-change.spec
 * set the server env to this value (via TEST_STRIPE_WEBHOOK_SECRET env var) and
 * use sign() below to produce matching signatures.
 *
 * This constant MUST NOT be set in any production-bound config path.
 */
export const STRIPE_WEBHOOK_TEST_SECRET = "whsec_testonly_e2e_playwright_secret_1234567890";

/**
 * Produce a Stripe-compatible webhook signature for the given payload.
 *
 * Format: t=<unix_seconds>,v1=<hmac_hex>
 *
 * @param payload   - Raw JSON string of the Stripe event object.
 * @param secret    - Webhook secret (whsec_...). Use STRIPE_WEBHOOK_TEST_SECRET in tests.
 * @param timestamp - Unix timestamp in seconds. Defaults to now.
 */
export function signStripeWebhook(
  payload: string,
  secret: string = STRIPE_WEBHOOK_TEST_SECRET,
  timestamp: number = Math.floor(Date.now() / 1000),
): string {
  const signedPayload = `${timestamp}.${payload}`;
  const hmac = crypto
    .createHmac("sha256", secret.replace(/^whsec_/, ""))
    .update(signedPayload, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${hmac}`;
}

/**
 * Build a minimal customer.subscription.updated Stripe event object.
 * The tenantId metadata field is used by the webhook handler to look up
 * the Tenant CR.
 */
export function buildSubscriptionUpdatedEvent(opts: {
  eventId?: string;
  subscriptionId?: string;
  tenantId: string;
  newPriceId: string;
  previousPriceId?: string;
  status?: string;
}): object {
  const subscriptionId = opts.subscriptionId ?? `sub_e2e_${Date.now()}`;
  const eventId = opts.eventId ?? `evt_e2e_${Date.now()}`;
  const now = Math.floor(Date.now() / 1000);

  const subscriptionObject = {
    id: subscriptionId,
    object: "subscription",
    status: opts.status ?? "active",
    customer: `cus_e2e_${Date.now()}`,
    current_period_end: now + 30 * 86400,
    trial_end: null,
    items: {
      data: [
        {
          price: {
            id: opts.newPriceId,
          },
        },
      ],
    },
    metadata: {
      tenantId: opts.tenantId,
      userId: "e2e-test-user",
      ownerEmail: "e2e@test.zero-day.local",
    },
  };

  return {
    id: eventId,
    type: "customer.subscription.updated",
    data: {
      object: subscriptionObject,
      previous_attributes: opts.previousPriceId
        ? {
            items: {
              data: [
                {
                  price: {
                    id: opts.previousPriceId,
                  },
                },
              ],
            },
          }
        : {},
    },
  };
}

/**
 * Build a minimal checkout.session.completed Stripe event.
 */
export function buildCheckoutCompletedEvent(opts: {
  eventId?: string;
  sessionId?: string;
  tenantSlug: string;
  userId?: string;
  amount?: number;
}): object {
  const sessionId = opts.sessionId ?? `cs_e2e_${Date.now()}`;
  const eventId = opts.eventId ?? `evt_e2e_${Date.now()}`;

  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        client_reference_id: opts.tenantSlug,
        customer_details: { email: "e2e@test.zero-day.local" },
        payment_intent: `pi_e2e_${Date.now()}`,
        amount_total: opts.amount ?? 4900,
        currency: "usd",
        metadata: {
          user_id: opts.userId ?? "e2e-test-user",
        },
      },
    },
  };
}

/**
 * Build a minimal invoice.payment_failed Stripe event.
 */
export function buildPaymentFailedEvent(opts: {
  eventId?: string;
  tenantId: string;
  amount?: number;
}): object {
  const eventId = opts.eventId ?? `evt_e2e_${Date.now()}`;

  return {
    id: eventId,
    type: "invoice.payment_failed",
    data: {
      object: {
        id: `in_e2e_${Date.now()}`,
        object: "invoice",
        amount_due: opts.amount ?? 4900,
        currency: "usd",
        metadata: {
          tenantId: opts.tenantId,
          ownerEmail: "e2e@test.zero-day.local",
        },
        lines: {
          data: [
            {
              period: {
                end: Math.floor(Date.now() / 1000) + 30 * 86400,
              },
            },
          ],
        },
      },
    },
  };
}

/**
 * Stub the Stripe checkout session creation endpoint so plan-change tests
 * don't need a live STRIPE_SECRET_KEY. The stub returns a fake checkout URL
 * that Playwright can then intercept.
 *
 * @param context     - Playwright BrowserContext.
 * @param checkoutUrl - URL the stub should return as the checkout redirect target.
 */
export async function stubStripeCheckout(
  context: BrowserContext,
  checkoutUrl: string = "https://checkout.stripe.test/mock",
): Promise<void> {
  await context.route("**/api/billing/checkout**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: checkoutUrl }),
    });
  });
}

/**
 * Navigate to the billing settings page.
 */
export async function goToBillingPage(page: Page): Promise<void> {
  await page.goto("/dashboard/pages/settings/billing");
  await page.waitForLoadState("domcontentloaded");
}
