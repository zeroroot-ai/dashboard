// @crd-authz-exempt-route: stripe-signature-verified, every request is
// authenticated via Stripe-Signature header (HMAC with STRIPE_WEBHOOK_SECRET)
// before any Tenant CR mutation runs. Returning 400 on invalid signature is
// the auth boundary; the request never reaches a patchTenant call without a
// verified Stripe.Event in hand.
/**
 * Stripe webhook endpoint.
 *
 * Receives POST events from Stripe, verifies signature, and drives
 * post-checkout provisioning state: either activating the Tenant CR
 * (billing confirmed) or issuing a refund and sending a rollback email
 * (provisioning failed).
 *
 * Security contract:
 * - ALWAYS verify the Stripe-Signature header before trusting any payload.
 * - Return 400 on invalid signature so Stripe knows to retry with a valid event.
 * - Return 200 for every other outcome (including rollback) so Stripe does not
 *   retry legitimate events that we've already processed.
 *
 * Idempotency:
 * - Each Stripe Event ID is recorded in the `gibson_stripe_events` table on
 *   first receipt. Duplicate deliveries (Stripe retries the same event) hit
 *   INSERT … ON CONFLICT DO NOTHING and return 200 immediately without
 *   re-running any side effects.
 */

import 'server-only';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type Stripe from 'stripe';

import { verifyWebhookSignature, refundCharge } from '@/src/lib/billing/stripe';
import { getTenant, patchTenant } from '@/src/lib/k8s/tenants';
import { getEmailProvider } from '@/src/lib/email/provider';
import {
  render as renderBillingRollbackEmail,
} from '@/src/lib/email/templates/billing-rollback';
import {
  render as renderCheckoutCompletedEmail,
} from '@/src/lib/email/templates/billing-checkout-completed';
import {
  render as renderTrialWillEndEmail,
} from '@/src/lib/email/templates/billing-trial-will-end';
import {
  render as renderPaymentFailedEmail,
} from '@/src/lib/email/templates/billing-payment-failed';
import {
  render as renderSubscriptionCancelledEmail,
} from '@/src/lib/email/templates/billing-subscription-cancelled';
import {
  render as renderPlanChangedEmail,
} from '@/src/lib/email/templates/billing-plan-changed';
import { emitAuthAudit } from '@/src/lib/audit/auth';
import { serviceClient } from '@/src/lib/gibson-client';
import { BillingService } from '@/src/gen/gibson/billing/v1/billing_pb';
import { logger } from '@/src/lib/logger';
import { incBillingEvent } from '@/src/lib/metrics/billing';

// Price env var → tier display name mapping (for plan-changed email).
// STRIPE_PRICE_* are OPTIONAL, only set when billing is enabled. We omit
// missing entries entirely rather than collapsing them onto a sentinel ''
// key (which would conflate every absent tier into "Enterprise").
// subscriptionPeriodEndIso extracts the current period end as an ISO string,
// tolerating Stripe API changes and missing values. Stripe moved
// current_period_end off the Subscription and onto the SubscriptionItem
// (API 2025-03+), so we read the item first and fall back to the legacy
// top-level field. A missing/non-finite value returns undefined instead of
// throwing — `new Date(undefined * 1000).toISOString()` throws RangeError
// "Invalid time value", which previously crashed the webhook handler before it
// could stamp billing-active, wedging card-first signups at provisioning
// (dashboard#785).
function subscriptionPeriodEndIso(subscription: Stripe.Subscription): string | undefined {
  const item = subscription.items?.data?.[0] as unknown as {
    current_period_end?: number;
  } | undefined;
  const legacy = (subscription as unknown as { current_period_end?: number })
    .current_period_end;
  const unix = item?.current_period_end ?? legacy;
  if (typeof unix !== 'number' || !Number.isFinite(unix)) return undefined;
  return new Date(unix * 1000).toISOString();
}

function buildPriceToTierName(): Record<string, string> {
  const out: Record<string, string> = {};
  const team = process.env.STRIPE_PRICE_TEAM;
  const org = process.env.STRIPE_PRICE_ORG;
  const enterprise = process.env.STRIPE_PRICE_ENTERPRISE;
  if (team) out[team] = 'Team';
  if (org) out[org] = 'Org';
  if (enterprise) out[enterprise] = 'Enterprise';
  return out;
}
const PRICE_TO_TIER_NAME: Record<string, string> = buildPriceToTierName();

// PUBLIC_URL is REQUIRED at boot (src/lib/env-validator.ts), no fallback.
// DASHBOARD_SUPPORT_EMAIL is OPTIONAL (a brand default is acceptable).
// We evaluate these lazily inside handlers because module-load happens
// before instrumentation.ts validation in some Next.js configurations.
function getSupportEmail(): string {
  return process.env.DASHBOARD_SUPPORT_EMAIL ?? 'support@zeroroot.ai';
}
function getDashboardUrl(): string {
  // PUBLIC_URL is REQUIRED at boot (src/lib/env-validator.ts).
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    throw new Error(
      '[billing/webhook] PUBLIC_URL is required (see src/lib/env-validator.ts).',
    );
  }
  return publicUrl;
}
function getPortalUrl(): string {
  return `${getDashboardUrl()}/dashboard/pages/settings/billing`;
}
function getPricingUrl(): string {
  return `${getDashboardUrl()}/pricing`;
}

// ---------------------------------------------------------------------------
// Idempotency helpers, daemon-delegated via BillingService RPCs
// ---------------------------------------------------------------------------

/**
 * Record the event ID via the daemon's BillingService.RecordWebhookEvent RPC.
 * Returns true when this is the first (novel) occurrence; false on replay.
 *
 * The daemon inserts into the `webhook_idempotency` table owned by the platform
 * Postgres, the dashboard no longer holds a pg Pool.
 *
 * @param eventId   - Stripe event ID (evt_...).
 * @param eventType - Stripe event type string.
 * @param tenantId  - Tenant slug this event is attributed to (may be empty).
 */
async function recordEventIfNew(
  eventId: string,
  eventType: string,
  tenantId: string,
): Promise<boolean> {
  // The BillingService RPCs use tenant_from_identity deriver; tenantId in
  // the request body is informational metadata only, pass '' when the
  // event predates tenant assignment (pre-tenant checkout events, etc.).
  const client = serviceClient(BillingService, tenantId);
  const resp = await client.recordWebhookEvent({ eventId, eventType, tenantId });
  return resp.isNew;
}

// ---------------------------------------------------------------------------
// Tenant CR condition inspection helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the Tenant CR status indicates that provisioning has
 * definitively failed and the tenant should not be activated.
 *
 * Two failure conditions are recognised:
 *   1. Blocked=True , the saga runner set a permanent block (e.g.
 *      SlugCollision or SagaFailed after max retries).
 *   2. Ready=False with reason=ProvisioningFailed, the foundation step
 *      or a saga step reported a hard failure.
 */
function isProvisioningFailed(tenant: Awaited<ReturnType<typeof getTenant>>): boolean {
  const conditions = tenant.status?.conditions ?? [];

  const blocked = conditions.find((c) => c.type === 'Blocked');
  if (blocked?.status === 'True') return true;

  const ready = conditions.find((c) => c.type === 'Ready');
  if (ready?.status === 'False' && ready?.reason === 'ProvisioningFailed') return true;

  return false;
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const tenantSlug = session.client_reference_id;
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  const ownerEmail =
    session.customer_details?.email ?? session.customer_email ?? '';

  if (!tenantSlug) {
    logger.error(
      { sessionId: session.id },
      '[billing/webhook] checkout.session.completed missing client_reference_id, cannot reconcile',
    );
    return;
  }

  // Look up the Tenant CR to check provisioning state.
  let tenant: Awaited<ReturnType<typeof getTenant>> | null = null;
  try {
    tenant = await getTenant(tenantSlug);
  } catch (err) {
    logger.error(
      { tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) },
      '[billing/webhook] Failed to get Tenant CR',
    );
    // If we cannot reach the K8s API we do NOT issue a refund speculatively -
    // a transient API outage should not result in money movement. Stripe will
    // retry the event and we'll handle it on the next attempt.
    throw err;
  }

  if (isProvisioningFailed(tenant)) {
    // Provisioning has definitively failed, refund the charge and notify the user.
    if (paymentIntentId) {
      try {
        await refundCharge(paymentIntentId, 'requested_by_customer');
        logger.info(
          { tenantId: tenantSlug, paymentIntentId },
          '[billing/webhook] Refund issued for failed provisioning',
        );
      } catch (err) {
        logger.error(
          { tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) },
          '[billing/webhook] Refund failed',
        );
        // Re-throw: Stripe will retry and we'll attempt the refund again.
        throw err;
      }
    }

    // Send rollback notification email.
    if (ownerEmail) {
      try {
        const amountTotal = session.amount_total ?? 0;
        const currency = (session.currency ?? 'usd').toUpperCase();
        const supportEmail = getSupportEmail();

        await getEmailProvider().send(
          renderBillingRollbackEmail({
            email: ownerEmail,
            chargeAmount: amountTotal,
            currency,
            supportEmail,
          }),
        );
      } catch (err) {
        // Email failure is non-fatal for the webhook response, the refund has
        // already been issued. Log but don't re-throw: we want Stripe to see a
        // 200 so it doesn't resend the event and trigger a duplicate refund.
        logger.error(
          { tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) },
          '[billing/webhook] Failed to send rollback email',
        );
      }
    }

    emitAuthAudit({
      action: 'billing_rollback',
      outcome: 'ok',
      userId: session.metadata?.user_id ?? 'unknown',
      targetTenant: tenantSlug,
      reason: 'provisioning_failed',
    });
    return;
  }

  // Provisioning is OK, activate billing on the Tenant CR.
  try {
    await patchTenant(tenantSlug, {
      metadata: {
        annotations: {
          'gibson.zeroroot.ai/billing-active': 'true',
        },
      },
    });
  } catch (err) {
    logger.error(
      { tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) },
      '[billing/webhook] Failed to patch Tenant CR with billing-active annotation',
    );
    // Re-throw: Stripe retries will attempt the patch again.
    throw err;
  }

  emitAuthAudit({
    action: 'signup_completed',
    outcome: 'ok',
    userId: session.metadata?.user_id ?? 'unknown',
    targetTenant: tenantSlug,
    reason: 'billing_confirmed',
  });
}

function handleCheckoutSessionExpiredOrFailed(
  session: Stripe.Checkout.Session,
  eventType: string,
): void {
  const tenantSlug = session.client_reference_id;
  emitAuthAudit({
    action: 'signup_failed',
    outcome: 'failed',
    userId: session.metadata?.user_id ?? 'unknown',
    targetTenant: tenantSlug ?? undefined,
    reason: eventType,
  });
  // No active cleanup: the operator's 1-hour BillingAbandoned GC will collect
  // the Tenant CR if billing confirmation never arrives.
}

// ---------------------------------------------------------------------------
// Subscription lifecycle handlers
// ---------------------------------------------------------------------------

/**
 * Helper: resolve owner email from Stripe subscription or Tenant CR metadata.
 * Falls back to an empty string if not available (email dispatch is non-fatal).
 */
function resolveOwnerEmail(subscription: Stripe.Subscription): string {
  return (subscription.metadata?.ownerEmail as string | undefined) ?? '';
}

/**
 * Handle customer.subscription.created, patch billing status on Tenant CR.
 */
async function handleSubscriptionCreated(
  subscription: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  const tenantSlug = subscription.metadata?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] subscription.created missing tenantId metadata');
    return;
  }

  const priceId = subscription.items.data[0]?.price.id ?? '';
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = subscriptionPeriodEndIso(subscription);

  // Card-first signup (dashboard#769): the embedded Payment Element creates
  // the trialing subscription directly — there is no checkout.session.completed
  // event — so this handler is what releases the saga's
  // WaitForBillingConfirmation step. Stamp the billing-active annotation (the
  // signal the operator polls) whenever the subscription starts in a paid
  // state (trialing or active). Other statuses (incomplete, past_due) must NOT
  // release provisioning.
  const billingActive =
    subscription.status === 'trialing' || subscription.status === 'active';

  await patchTenant(tenantSlug, {
    ...(billingActive
      ? { metadata: { annotations: { 'gibson.zeroroot.ai/billing-active': 'true' } } }
      : {}),
    status: {
      billing: {
        subscriptionId: subscription.id,
        customerId: typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id ?? '',
        priceId,
        status: subscription.status,
        trialEnd,
        currentPeriodEnd,
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  // Send checkout-completed email (non-fatal).
  const ownerEmail = resolveOwnerEmail(subscription);
  if (ownerEmail && trialEnd) {
    try {
      await getEmailProvider().send(
        renderCheckoutCompletedEmail({
          email: ownerEmail,
          tierName: PRICE_TO_TIER_NAME[priceId] ?? 'Gibson',
          trialEndDate: new Date(subscription.trial_end! * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          dashboardUrl: getDashboardUrl(),
          portalUrl: getPortalUrl(),
          supportEmail: getSupportEmail(),
        }),
      );
    } catch (err) {
      logger.error({ tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Failed to send checkout-completed email');
    }
  }

  emitAuthAudit({
    action: 'billing.checkout_completed',
    outcome: 'ok',
    userId: subscription.metadata?.userId ?? 'unknown',
    targetTenant: tenantSlug,
    reason: 'subscription_created',
  });

  incBillingEvent('customer.subscription.created', 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId, subscriptionId: subscription.id }, '[billing/webhook] subscription.created handled');
}

/**
 * Handle customer.subscription.updated, patch billing status; send plan-changed email if price changed.
 */
async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription,
  eventId: string,
  previousPriceId?: string,
): Promise<void> {
  const tenantSlug = subscription.metadata?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] subscription.updated missing tenantId metadata');
    return;
  }

  const newPriceId = subscription.items.data[0]?.price.id ?? '';
  const trialEnd = subscription.trial_end
    ? new Date(subscription.trial_end * 1000).toISOString()
    : undefined;
  const currentPeriodEnd = subscriptionPeriodEndIso(subscription);

  await patchTenant(tenantSlug, {
    status: {
      billing: {
        subscriptionId: subscription.id,
        customerId: typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id ?? '',
        priceId: newPriceId,
        status: subscription.status,
        trialEnd,
        currentPeriodEnd,
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  // Send plan-changed email only when price changed (non-fatal).
  if (previousPriceId && previousPriceId !== newPriceId) {
    const ownerEmail = resolveOwnerEmail(subscription);
    if (ownerEmail) {
      try {
        await getEmailProvider().send(
          renderPlanChangedEmail({
            email: ownerEmail,
            oldTierName: PRICE_TO_TIER_NAME[previousPriceId] ?? 'Previous plan',
            newTierName: PRICE_TO_TIER_NAME[newPriceId] ?? 'New plan',
            newMonthlyAmount: 'see billing portal',
            effectiveDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            supportEmail: getSupportEmail(),
          }),
        );
      } catch (err) {
        logger.error({ tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Failed to send plan-changed email');
      }
    }
  }

  emitAuthAudit({
    action: 'billing.subscription_updated',
    outcome: 'ok',
    userId: subscription.metadata?.userId ?? 'unknown',
    targetTenant: tenantSlug,
    reason: previousPriceId !== newPriceId ? 'plan_changed' : 'status_updated',
  });

  incBillingEvent('customer.subscription.updated', 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId }, '[billing/webhook] subscription.updated handled');
}

/**
 * Handle customer.subscription.deleted, cancel billing status, write teardown annotation.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  const tenantSlug = subscription.metadata?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] subscription.deleted missing tenantId metadata');
    return;
  }

  const teardownAfter = new Date(Date.now() + 7 * 86400_000).toISOString();

  await patchTenant(tenantSlug, {
    metadata: {
      annotations: {
        'gibson.zeroroot.ai/teardown-after': teardownAfter,
      },
    },
    status: {
      billing: {
        status: 'cancelled',
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  // Send cancellation email (non-fatal).
  const ownerEmail = resolveOwnerEmail(subscription);
  if (ownerEmail) {
    try {
      await getEmailProvider().send(
        renderSubscriptionCancelledEmail({
          email: ownerEmail,
          gracePeriodEndDate: new Date(Date.now() + 7 * 86400_000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          pricingUrl: getPricingUrl(),
          supportEmail: getSupportEmail(),
        }),
      );
    } catch (err) {
      logger.error({ tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Failed to send cancellation email');
    }
  }

  emitAuthAudit({
    action: 'billing.subscription_cancelled',
    outcome: 'ok',
    userId: subscription.metadata?.userId ?? 'unknown',
    targetTenant: tenantSlug,
    reason: 'subscription_deleted',
  });

  incBillingEvent('customer.subscription.deleted', 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId, teardownAfter }, '[billing/webhook] subscription.deleted handled');
}

/**
 * Handle customer.subscription.trial_will_end, set trialEndsSoon flag.
 */
async function handleTrialWillEnd(
  subscription: Stripe.Subscription,
  eventId: string,
): Promise<void> {
  const tenantSlug = subscription.metadata?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] trial_will_end missing tenantId metadata');
    return;
  }

  await patchTenant(tenantSlug, {
    status: {
      billing: {
        trialEndsSoon: true,
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  // Send trial-will-end email (non-fatal).
  const ownerEmail = resolveOwnerEmail(subscription);
  const daysRemaining = subscription.trial_end
    ? Math.max(0, Math.ceil((subscription.trial_end * 1000 - Date.now()) / (1000 * 60 * 60 * 24)))
    : 3;
  if (ownerEmail) {
    try {
      await getEmailProvider().send(
        renderTrialWillEndEmail({
          email: ownerEmail,
          tierName: PRICE_TO_TIER_NAME[subscription.items.data[0]?.price.id ?? ''] ?? 'Gibson',
          daysRemaining,
          firstChargeDate: subscription.trial_end
            ? new Date(subscription.trial_end * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
            : 'soon',
          firstChargeAmount: 'see billing portal',
          portalUrl: getPortalUrl(),
          pricingUrl: getPricingUrl(),
          supportEmail: getSupportEmail(),
        }),
      );
    } catch (err) {
      logger.error({ tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Failed to send trial-will-end email');
    }
  }

  incBillingEvent('customer.subscription.trial_will_end', 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId, daysRemaining }, '[billing/webhook] trial_will_end handled');
}

/**
 * Handle invoice.paid, clear past_due and trial states.
 */
async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  eventId: string,
): Promise<void> {
  const tenantSlug = (invoice.metadata as Record<string, string> | null)?.tenantId
    ?? ((invoice as unknown as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata as Record<string, string> | undefined)?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] invoice.paid missing tenantId metadata');
    return;
  }

  const currentPeriodEnd = invoice.lines?.data?.[0]?.period?.end
    ? new Date(invoice.lines.data[0].period.end * 1000).toISOString()
    : undefined;

  await patchTenant(tenantSlug, {
    status: {
      billing: {
        status: 'active',
        pastDueSince: null,
        trialEndsSoon: false,
        currentPeriodEnd,
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  emitAuthAudit({
    action: 'billing.invoice_paid',
    outcome: 'ok',
    userId: 'system',
    targetTenant: tenantSlug,
    reason: 'invoice_paid',
  });

  incBillingEvent('invoice.paid', 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId }, '[billing/webhook] invoice.paid handled');
}

/**
 * Handle invoice.payment_failed and invoice.payment_action_required.
 * Sets past_due status; pastDueSince is only written if not already set.
 */
async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  eventId: string,
  eventType: string,
): Promise<void> {
  const tenantSlug = (invoice.metadata as Record<string, string> | null)?.tenantId
    ?? ((invoice as unknown as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata as Record<string, string> | undefined)?.tenantId;
  if (!tenantSlug) {
    logger.warn({ stripeEventId: eventId }, '[billing/webhook] invoice.payment_failed missing tenantId metadata');
    return;
  }

  // Read current billing status to preserve original pastDueSince timestamp.
  let currentPastDueSince: string | undefined;
  try {
    const tenant = await getTenant(tenantSlug);
    currentPastDueSince = tenant.status?.billing?.pastDueSince;
  } catch {
    // Non-fatal, proceed without the read; will write pastDueSince.
  }

  await patchTenant(tenantSlug, {
    status: {
      billing: {
        status: 'past_due',
        pastDueSince: currentPastDueSince ?? new Date().toISOString(),
        lastWebhookEventId: eventId,
        lastUpdated: new Date().toISOString(),
      },
    },
  });

  // Send payment-failed email (non-fatal).
  const ownerEmail = (invoice.metadata as Record<string, string> | null)?.ownerEmail ?? '';
  if (ownerEmail) {
    try {
      await getEmailProvider().send(
        renderPaymentFailedEmail({
          email: ownerEmail,
          chargeAmount: invoice.amount_due,
          currency: (invoice.currency ?? 'usd').toUpperCase(),
          portalUrl: getPortalUrl(),
          supportEmail: getSupportEmail(),
        }),
      );
    } catch (err) {
      logger.error({ tenantId: tenantSlug, err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Failed to send payment-failed email');
    }
  }

  emitAuthAudit({
    action: 'billing.payment_failed',
    outcome: 'failed',
    userId: 'system',
    targetTenant: tenantSlug,
    reason: eventType,
  });

  incBillingEvent(eventType, 'success');
  logger.info({ tenantId: tenantSlug, stripeEventId: eventId }, `[billing/webhook] ${eventType} handled`);
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/webhook, 410 tombstone.
 *
 * This endpoint exists as a tombstone for the webhook migration plan
 * (spec: stripe-billing-integration R12.4, R12.5). It returns 410 Gone
 * unconditionally to signal to any legacy Stripe webhook destinations
 * pointing at this path that they should be updated.
 *
 * Migration Phase 2 cutover: once the 30-day parallel-listen window closes
 * and all Stripe webhook traffic has been moved to webhooks.zeroroot.ai/stripe,
 * the body of the POST handler below can be replaced with this same 410
 * response to fully retire the endpoint.
 *
 * To advance to Phase 2 (full tombstone):
 * 1. Verify Stripe Dashboard shows zero deliveries to this path for 72 hours.
 * 2. Replace the POST handler body with: return NextResponse.json({ gone: true }, { status: 410 });
 * 3. Remove the stripe-webhook-cutover runbook reference; update to "completed".
 */
export async function GET(_req: NextRequest): Promise<NextResponse> {
  return NextResponse.json({ gone: true }, { status: 410 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body for signature verification, must happen before any parsing.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('stripe-signature') ?? '';

  if (!signatureHeader) {
    logger.warn('[billing/webhook] Request missing Stripe-Signature header');
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const event = verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // Idempotency guard, silently ack duplicate deliveries.
  // Best-effort extract tenantId from event metadata for observability;
  // falls back to '' if not present (pre-tenant events, session events, etc.).
  const eventObj = event.data.object as unknown as { metadata?: Record<string, string> };
  const resolvedTenantId = eventObj?.metadata?.['tenantId'] ?? '';
  const isNew = await recordEventIfNew(event.id, event.type, resolvedTenantId);
  if (!isNew) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case 'checkout.session.expired':
      case 'checkout.session.async_payment_failed':
        handleCheckoutSessionExpiredOrFailed(
          event.data.object as Stripe.Checkout.Session,
          event.type,
        );
        break;

      case 'customer.subscription.created':
        await handleSubscriptionCreated(
          event.data.object as Stripe.Subscription,
          event.id,
        );
        break;

      case 'customer.subscription.updated': {
        const previousPriceId = (
          event.data.previous_attributes as { items?: { data?: Array<{ price?: { id?: string } }> } } | undefined
        )?.items?.data?.[0]?.price?.id;
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription,
          event.id,
          previousPriceId,
        );
        break;
      }

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
          event.id,
        );
        break;

      case 'customer.subscription.trial_will_end':
        await handleTrialWillEnd(
          event.data.object as Stripe.Subscription,
          event.id,
        );
        break;

      case 'invoice.paid':
        await handleInvoicePaid(
          event.data.object as Stripe.Invoice,
          event.id,
        );
        break;

      case 'invoice.payment_failed':
      case 'invoice.payment_action_required':
        await handleInvoicePaymentFailed(
          event.data.object as Stripe.Invoice,
          event.id,
          event.type,
        );
        break;

      default:
        // Unhandled event type, acknowledge without action.
        break;
    }
  } catch (err) {
    // Processing failed, remove the idempotency record so Stripe can retry.
    try {
      const rollbackClient = serviceClient(BillingService, resolvedTenantId);
      await rollbackClient.deleteWebhookEvent({ eventId: event.id });
    } catch {
      // Best-effort cleanup.
    }
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[billing/webhook] Unhandled processing error');
    return NextResponse.json({ error: 'processing error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
