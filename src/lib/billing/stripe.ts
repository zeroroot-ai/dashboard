/**
 * Centralized Stripe SDK wrapper for Gibson Dashboard.
 *
 * All Stripe interactions in the dashboard must go through this module.
 * Raw Stripe SDK usage outside this file is not permitted — it ensures
 * consistent idempotency, signature verification, and configuration
 * validation across every billing code path.
 *
 * Security invariants:
 * - Webhook signature is always verified before any event data is trusted.
 * - Secret key is never logged or included in error messages.
 * - Refund is a money-moving operation: callers are responsible for ensuring
 *   the provisioning failure is confirmed before calling refundCharge.
 */

import 'server-only';

import type Stripe from 'stripe';

import { logger } from '@/src/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Paid plan tiers that map to Stripe price IDs.
 * `solo` is the free self-serve tier and intentionally absent here.
 * Names match `TenantTier` in `src/lib/k8s/types.ts` and the operator's
 * `plans.PlanID` Go enum — single source of truth for plan identity.
 */
export type BillingTier =
  | 'squad'
  | 'org'
  | 'platform'
  | 'enterprise-cloud'
  | 'enterprise-onprem'
  | 'public-sector';

/** Environment variable names for paid-plan price IDs. */
const PRICE_ENV_MAP: Record<BillingTier, string> = {
  squad: 'STRIPE_PRICE_SQUAD',
  org: 'STRIPE_PRICE_ORG',
  platform: 'STRIPE_PRICE_PLATFORM',
  'enterprise-cloud': 'STRIPE_PRICE_ENTERPRISE_CLOUD',
  'enterprise-onprem': 'STRIPE_PRICE_ENTERPRISE_ONPREM',
  'public-sector': 'STRIPE_PRICE_PUBLIC_SECTOR',
};

// ---------------------------------------------------------------------------
// Lazy singleton Stripe client
// ---------------------------------------------------------------------------

let _stripeClient: Stripe | null = null;

/**
 * Return the singleton Stripe client, lazily initialized from STRIPE_SECRET_KEY.
 *
 * Throws if STRIPE_SECRET_KEY is not set. This is intentional: billing
 * operations must never silently fall back to an unconfigured state.
 */
export function getStripeClient(): Stripe {
  if (_stripeClient) return _stripeClient;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      '[billing/stripe] STRIPE_SECRET_KEY is not set. ' +
        'Configure it via the Helm chart (dashboard.billing.stripeSecretKey) ' +
        'or the STRIPE_SECRET_KEY environment variable.',
    );
  }

  // Dynamic import defers the Stripe module until first use, keeping startup
  // cost low in pods that don't process billing events on boot.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const StripeSDK = require('stripe') as typeof import('stripe');
  _stripeClient = new StripeSDK.default(key, {
    apiVersion: '2026-03-25.dahlia',
    typescript: true,
    // Telemetry off — avoid leaking build/runtime metadata to Stripe's
    // analytics pipeline. Unnecessary in a controlled SaaS environment.
    telemetry: false,
  });
  return _stripeClient;
}

/** Test-only: reset the cached client so env changes take effect. */
export function __resetStripeClientForTests(): void {
  _stripeClient = null;
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a raw Stripe webhook payload against the provided signature header.
 *
 * Returns the parsed Stripe.Event on success, or null when the signature is
 * invalid (tampered payload, wrong secret, replay outside tolerance). The
 * webhook route MUST return HTTP 400 when this returns null.
 *
 * The STRIPE_WEBHOOK_SECRET environment variable is read at call time (not
 * cached) so rotating the secret in a running pod takes effect on the next
 * event without a restart.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
): Stripe.Event | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('[billing/stripe] STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook.');
    return null;
  }

  try {
    const stripe = getStripeClient();
    return stripe.webhooks.constructEvent(payload, signatureHeader, secret);
  } catch (err) {
    // constructEvent throws on any signature failure (invalid, expired, etc.)
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, '[billing/stripe] Webhook signature verification failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------

/**
 * Issue a full refund against a PaymentIntent.
 *
 * This is a money-moving operation. Callers MUST only invoke it after
 * confirming that tenant provisioning has definitively failed (Blocked=True
 * or Ready=False with reason ProvisioningFailed on the Tenant CR).
 *
 * The refund is idempotent at the Stripe level: if a refund already exists for
 * the PaymentIntent, Stripe returns the existing refund object.
 *
 * @param paymentIntentId - The Stripe PaymentIntent ID (pi_...).
 * @param reason          - Refund reason surfaced to Stripe and card statement.
 *                          Must be one of Stripe's accepted reason values.
 */
export async function refundCharge(
  paymentIntentId: string,
  reason: Stripe.RefundCreateParams.Reason = 'requested_by_customer',
): Promise<Stripe.Refund> {
  const stripe = getStripeClient();
  return stripe.refunds.create({
    payment_intent: paymentIntentId,
    reason,
  });
}

// ---------------------------------------------------------------------------
// Types for new billing operations
// ---------------------------------------------------------------------------

/** Parameters for creating a Stripe Checkout session. */
export interface CheckoutSessionParams {
  /** Billing tier — must be a self-serve tier (squad/org/platform), not a contact-sales tier. */
  tier: BillingTier;
  /** Stripe Price ID for the tier (resolved from PRICE_ENV_MAP). */
  priceId: string;
  /** Stripe customer ID to associate with the session (optional). */
  customerId?: string;
  /** Pre-fill customer email on the Checkout page (optional, ignored if customerId set). */
  customerEmail?: string;
  /** Tenant slug used for client_reference_id and metadata. */
  tenantSlug: string;
  /** Idempotency key for the Stripe API call. */
  idempotencyKey: string;
}

/** Parameters for creating a Stripe Billing Portal session. */
export interface PortalSessionParams {
  /** Stripe customer ID (cus_...). */
  customerId: string;
  /** URL to return to after the portal session. */
  returnUrl: string;
  /** Idempotency key for the Stripe API call. */
  idempotencyKey: string;
}

/** Contact-sales tiers that must not be used with Stripe Checkout. */
const CONTACT_SALES_TIERS = new Set<BillingTier>([
  'enterprise-cloud',
  'enterprise-onprem',
  'public-sector',
]);

// ---------------------------------------------------------------------------
// Price ID lookup
// ---------------------------------------------------------------------------

/**
 * Return the Stripe Price ID for the given tier from environment variables,
 * or null if the env var is unset.
 *
 * Env vars: STRIPE_PRICE_SQUAD, STRIPE_PRICE_ORG, STRIPE_PRICE_PLATFORM,
 * STRIPE_PRICE_ENTERPRISE_CLOUD, STRIPE_PRICE_ENTERPRISE_ONPREM,
 * STRIPE_PRICE_PUBLIC_SECTOR.
 */
export function priceIdForTier(tier: string): string | null {
  const envKey = PRICE_ENV_MAP[tier as BillingTier];
  if (!envKey) return null;
  return process.env[envKey] ?? null;
}

// ---------------------------------------------------------------------------
// Checkout session
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Checkout session for a self-serve subscription.
 *
 * Always creates a subscription with a 14-day trial; trial cancels automatically
 * if no payment method is collected before trial end. Throws if called with
 * a contact-sales tier (enterprise-cloud, enterprise-onprem, public-sector).
 *
 * @throws If `params.tier` is a contact-sales tier.
 */
export async function createCheckoutSession(
  params: CheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
  if (CONTACT_SALES_TIERS.has(params.tier)) {
    throw new Error(
      `[billing/stripe] createCheckoutSession called with contact-sales tier "${params.tier}". ` +
        'Enterprise tiers must go through the sales flow, not Stripe Checkout.',
    );
  }

  const stripe = getStripeClient();
  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';

  return stripe.checkout.sessions.create(
    {
      mode: 'subscription',
      payment_method_collection: 'always',
      line_items: [{ price: params.priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
        metadata: { tenantId: params.tenantSlug },
      },
      client_reference_id: params.tenantSlug,
      ...(params.customerId ? { customer: params.customerId } : {}),
      ...(params.customerEmail && !params.customerId
        ? { customer_email: params.customerEmail }
        : {}),
      success_url: `${publicUrl}/onboarding/billing-confirmed?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/pricing?canceled=1`,
      metadata: { tenantId: params.tenantSlug, tier: params.tier },
    },
    { idempotencyKey: params.idempotencyKey },
  );
}

// ---------------------------------------------------------------------------
// Customer Portal session
// ---------------------------------------------------------------------------

/**
 * Create a Stripe Billing Portal session for self-serve subscription management.
 *
 * Portal configuration is read from STRIPE_PORTAL_CONFIGURATION_ID. If unset,
 * Stripe uses the default portal configuration for the account.
 */
export async function createPortalSession(
  params: PortalSessionParams,
): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripeClient();
  const configurationId = process.env.STRIPE_PORTAL_CONFIGURATION_ID;

  return stripe.billingPortal.sessions.create(
    {
      customer: params.customerId,
      return_url: params.returnUrl,
      ...(configurationId ? { configuration: configurationId } : {}),
    },
    { idempotencyKey: params.idempotencyKey },
  );
}

// ---------------------------------------------------------------------------
// Subscription helpers
// ---------------------------------------------------------------------------

/**
 * Retrieve a Stripe subscription by ID.
 *
 * Used by the billing reconciler to verify subscription state against the
 * live Stripe record (drift detection and trial enforcement).
 */
export async function getSubscription(
  subscriptionId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Update the trial end date of a Stripe subscription.
 *
 * Used by platform operators via `POST /api/admin/billing/trial-extension` to
 * grant trial extensions. The `idempotencyKey` must be unique per extension
 * event to prevent duplicate extensions from double-submits.
 *
 * @param subscriptionId  - The Stripe subscription ID (sub_...).
 * @param trialEnd        - New trial end date as a Unix timestamp (seconds).
 * @param idempotencyKey  - Unique key to make the call idempotent.
 */
export async function updateSubscriptionTrialEnd(
  subscriptionId: string,
  trialEnd: number,
  idempotencyKey: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(
    subscriptionId,
    { trial_end: trialEnd },
    { idempotencyKey },
  );
}

// ---------------------------------------------------------------------------
// Startup-time billing configuration validation
// ---------------------------------------------------------------------------

/**
 * Validate that all required billing environment variables are present when
 * paid tiers are enabled (DASHBOARD_BILLING_PAID_TIERS_ENABLED=true).
 *
 * Call this from auth-server startup alongside other startup checks. This
 * validation fails loudly (throws) so misconfigured deployments are caught
 * at pod startup rather than at user checkout.
 *
 * In development / free-tier-only deployments where
 * DASHBOARD_BILLING_PAID_TIERS_ENABLED is unset or false, this is a no-op.
 */
export function validateBillingConfig(): void {
  const enabled =
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED === 'true' ||
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED === '1';

  if (!enabled) return;

  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    // One env var per paid tier. Validated at startup; missing in dev or
    // free-tier-only deployments → set DASHBOARD_BILLING_PAID_TIERS_ENABLED
    // to false to skip this check entirely.
    'STRIPE_PRICE_SQUAD',
    'STRIPE_PRICE_ORG',
    'STRIPE_PRICE_PLATFORM',
    'STRIPE_PRICE_ENTERPRISE_CLOUD',
    'STRIPE_PRICE_ENTERPRISE_ONPREM',
    'STRIPE_PRICE_PUBLIC_SECTOR',
  ];

  const missing = required.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `[billing/stripe] Paid tiers are enabled (DASHBOARD_BILLING_PAID_TIERS_ENABLED=true) ` +
        `but the following required environment variables are missing: ${missing.join(', ')}. ` +
        `Set them in the Helm chart under dashboard.billing.* or as raw env vars.`,
    );
  }

  // Enforce Stripe key mode consistency to prevent test keys in production
  // and live keys in non-production environments.
  // The key VALUE is never logged — only whether it starts with sk_test_ or sk_live_.
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && secretKey.startsWith('sk_test_')) {
    throw new Error(
      '[billing/stripe] Production deployment detected with test-mode Stripe key',
    );
  }

  if (!isProduction && secretKey.startsWith('sk_live_')) {
    throw new Error(
      '[billing/stripe] Non-production deployment detected with live-mode Stripe key',
    );
  }
}
