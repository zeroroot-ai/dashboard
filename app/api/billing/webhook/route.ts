// @crd-authz-exempt-route: stripe-signature-verified — every request is
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
import { emitAuthAudit } from '@/src/lib/audit/auth';
import { getPool } from '@/src/lib/db';

// ---------------------------------------------------------------------------
// Idempotency table helpers
// ---------------------------------------------------------------------------

/**
 * Migration 0042 replaced the original `gibson_stripe_events` inline table
 * with the schema-managed `webhook_idempotency` table. The constant below
 * references the new table name.
 *
 * The `gibson_stripe_events` name is preserved as a view alias in the
 * migration so any external tooling using the old name continues to work
 * during the transition window.
 */
const EVENTS_TABLE = 'webhook_idempotency';

/**
 * Validate that the idempotency table exists. After migration 0042 ships
 * this is a lightweight no-op — the table is now schema-managed rather than
 * created inline. We still call it on each request to fail fast if the
 * migration has not yet run.
 */
async function ensureEventsTable(): Promise<void> {
  const result = await getPool().query(`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = $1
    LIMIT 1
  `, [EVENTS_TABLE]);
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(
      `[billing/webhook] Idempotency table "${EVENTS_TABLE}" does not exist. ` +
      'Run migration 0042_webhook_idempotency.sql before enabling billing.',
    );
  }
}

/**
 * Attempt to record the event ID. Returns true if this is a novel event
 * (first time seen), false if it is a duplicate (Stripe retry).
 *
 * INSERT … ON CONFLICT DO NOTHING is the canonical idempotency primitive:
 * on the first delivery the row is inserted and rowCount=1; on any replay
 * the constraint fires, no row is written, rowCount=0.
 *
 * @param eventId   - Stripe event ID (evt_...).
 * @param eventType - Stripe event type string (e.g. 'customer.subscription.created').
 * @param tenantId  - Tenant slug this event is attributed to (may be empty).
 */
async function recordEventIfNew(
  eventId: string,
  eventType: string,
  tenantId: string,
): Promise<boolean> {
  const result = await getPool().query(
    `INSERT INTO "${EVENTS_TABLE}" (event_id, event_type, tenant_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [eventId, eventType, tenantId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Tenant CR condition inspection helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the Tenant CR status indicates that provisioning has
 * definitively failed and the tenant should not be activated.
 *
 * Two failure conditions are recognised:
 *   1. Blocked=True  — the saga runner set a permanent block (e.g.
 *      SlugCollision or SagaFailed after max retries).
 *   2. Ready=False with reason=ProvisioningFailed — the foundation step
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
    console.error(
      '[billing/webhook] checkout.session.completed missing client_reference_id — cannot reconcile',
      { sessionId: session.id },
    );
    return;
  }

  // Look up the Tenant CR to check provisioning state.
  let tenant: Awaited<ReturnType<typeof getTenant>> | null = null;
  try {
    tenant = await getTenant(tenantSlug);
  } catch (err) {
    console.error(
      '[billing/webhook] Failed to get Tenant CR for',
      tenantSlug,
      err instanceof Error ? err.message : err,
    );
    // If we cannot reach the K8s API we do NOT issue a refund speculatively —
    // a transient API outage should not result in money movement. Stripe will
    // retry the event and we'll handle it on the next attempt.
    throw err;
  }

  if (isProvisioningFailed(tenant)) {
    // Provisioning has definitively failed — refund the charge and notify the user.
    if (paymentIntentId) {
      try {
        await refundCharge(paymentIntentId, 'requested_by_customer');
        console.info(
          '[billing/webhook] Refund issued for failed provisioning',
          { tenantSlug, paymentIntentId },
        );
      } catch (err) {
        console.error(
          '[billing/webhook] Refund failed for',
          tenantSlug,
          err instanceof Error ? err.message : err,
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
        const supportEmail =
          process.env.DASHBOARD_SUPPORT_EMAIL ?? 'support@zero-day.ai';

        await getEmailProvider().send(
          renderBillingRollbackEmail({
            email: ownerEmail,
            chargeAmount: amountTotal,
            currency,
            supportEmail,
          }),
        );
      } catch (err) {
        // Email failure is non-fatal for the webhook response — the refund has
        // already been issued. Log but don't re-throw: we want Stripe to see a
        // 200 so it doesn't resend the event and trigger a duplicate refund.
        console.error(
          '[billing/webhook] Failed to send rollback email for',
          tenantSlug,
          err instanceof Error ? err.message : err,
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

  // Provisioning is OK — activate billing on the Tenant CR.
  try {
    await patchTenant(tenantSlug, {
      metadata: {
        annotations: {
          'gibson.zero-day.ai/billing-active': 'true',
        },
      },
    });
  } catch (err) {
    console.error(
      '[billing/webhook] Failed to patch Tenant CR with billing-active annotation',
      tenantSlug,
      err instanceof Error ? err.message : err,
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
// Route handler
// ---------------------------------------------------------------------------

export const dynamic = 'force-dynamic';

/**
 * GET /api/billing/webhook — 410 tombstone.
 *
 * This endpoint exists as a tombstone for the webhook migration plan
 * (spec: stripe-billing-integration R12.4, R12.5). It returns 410 Gone
 * unconditionally to signal to any legacy Stripe webhook destinations
 * pointing at this path that they should be updated.
 *
 * Migration Phase 2 cutover: once the 30-day parallel-listen window closes
 * and all Stripe webhook traffic has been moved to webhooks.zero-day.ai/stripe,
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
  // Read raw body for signature verification — must happen before any parsing.
  const rawBody = await req.text();
  const signatureHeader = req.headers.get('stripe-signature') ?? '';

  if (!signatureHeader) {
    console.warn('[billing/webhook] Request missing Stripe-Signature header');
    return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  }

  const event = verifyWebhookSignature(rawBody, signatureHeader);
  if (!event) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }

  // Ensure the idempotency table is present (cheap no-op after first call).
  try {
    await ensureEventsTable();
  } catch (err) {
    console.error('[billing/webhook] Failed to ensure events table:', err);
    // Return 500 so Stripe retries — this is a transient infrastructure failure.
    return NextResponse.json({ error: 'storage error' }, { status: 500 });
  }

  // Idempotency guard — silently ack duplicate deliveries.
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

      default:
        // Unhandled event type — acknowledge without action.
        break;
    }
  } catch (err) {
    // Processing failed — remove the idempotency record so Stripe can retry.
    try {
      await getPool().query(
        `DELETE FROM "${EVENTS_TABLE}" WHERE event_id = $1`,
        [event.id],
      );
    } catch {
      // Best-effort cleanup.
    }
    console.error('[billing/webhook] Unhandled processing error:', err);
    return NextResponse.json({ error: 'processing error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
