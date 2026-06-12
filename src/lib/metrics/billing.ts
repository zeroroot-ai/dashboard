/**
 * Prometheus metrics for the Stripe billing subsystem.
 *
 * Naming follows Prometheus conventions: snake_case names, `_total` suffix on
 * counters. All metrics register against the shared `registry` singleton (see
 * `./registry.ts`) and are exposed via `/api/metrics`.
 *
 * Label cardinality is deliberately bounded. No tenant-id, user-id, email,
 * or IP address appears as a label, those explode cardinality and degrade
 * Prometheus query performance. Per-principal detail belongs in the audit
 * event stream (`src/lib/audit/auth.ts`), not in metrics.
 *
 * Consumed by:
 *   - `app/api/billing/webhook/route.ts`, increment on every terminal outcome.
 */

import { getOrCreateCounter } from "./helpers";

// ---------------------------------------------------------------------------
// Label type unions
// ---------------------------------------------------------------------------

/** Terminal outcome for a Stripe webhook event handler. */
export type BillingEventOutcome = "success" | "idempotent_replay" | "error";

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Total Stripe webhook events processed, partitioned by event type and
 * terminal outcome. Use this to build:
 *
 *   - Webhook handler success rate: `success / (success + error)`
 *   - Idempotent replay rate: `idempotent_replay / total`
 *   - Per-event-type processing volumes
 *
 * `event_type` mirrors Stripe's event type string (e.g.
 * `customer.subscription.created`, `invoice.payment_failed`).
 * `outcome` is one of `success | idempotent_replay | error`.
 */
export const stripeEventTotal = getOrCreateCounter({
  name: "gibson_stripe_event_total",
  help: "Total Stripe webhook events processed, by event type and outcome.",
  labelNames: ["event_type", "outcome"] as const,
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Increment `gibson_stripe_event_total` for the given event type and outcome.
 *
 * Safe to call from any webhook handler: silently no-ops if prom-client is
 * unavailable (edge / browser context, unit-test environments that skip
 * metric registration).
 *
 * @param eventType - Stripe event type string (e.g. `customer.subscription.created`).
 * @param outcome   - Terminal outcome of the handler execution.
 */
export function incBillingEvent(
  eventType: string,
  outcome: BillingEventOutcome,
): void {
  try {
    stripeEventTotal.inc({ event_type: eventType, outcome });
  } catch {
    // Defensive: never throw from a metrics helper, a prom-client failure
    // must not cause the webhook handler to return a non-200 to Stripe.
  }
}
