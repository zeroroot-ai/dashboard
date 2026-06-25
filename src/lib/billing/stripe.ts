/**
 * Centralized Stripe SDK wrapper for Gibson Dashboard.
 *
 * All Stripe interactions in the dashboard must go through this module.
 * Raw Stripe SDK usage outside this file is not permitted, it ensures
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

// Paid plan tiers + their env-var price-id slots are generated from
// plans.yaml, see scripts/gen-stripe-tiers.mjs. Drift is caught by
// scripts/check-stripe-tiers-fresh.mjs as part of pnpm prebuild.
export type { BillingTier } from './stripe_gen';
import { BillingTier, PRICE_ENV_MAP, CONTACT_SALES_TIERS as CONTACT_SALES_TIER_IDS, BILLING_TIER_IDS } from './stripe_gen';

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
    // Telemetry off, avoid leaking build/runtime metadata to Stripe's
    // analytics pipeline. Unnecessary in a controlled SaaS environment.
    telemetry: false,
  });
  return _stripeClient;
}

/** Test-only: reset the cached client so env changes take effect. */
export function __resetStripeClientForTests(): void {
  _stripeClient = null;
}

/**
 * Test-only: inject a fake Stripe client. getStripeClient() uses require()
 * to defer the SDK, which vi.mock('stripe') does not reliably intercept;
 * tests inject a stub here instead and the cached client short-circuits.
 */
export function __setStripeClientForTests(client: unknown): void {
  _stripeClient = client as Stripe;
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
    logger.error('[billing/stripe] STRIPE_WEBHOOK_SECRET is not set, cannot verify webhook.');
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
const CONTACT_SALES_TIERS = new Set<string>(CONTACT_SALES_TIER_IDS);

// ---------------------------------------------------------------------------
// Price ID lookup
// ---------------------------------------------------------------------------

/**
 * Return the Stripe Price ID for the given tier from environment variables,
 * or null if the env var is unset.
 *
 * Env vars: STRIPE_PRICE_TEAM, STRIPE_PRICE_ORG, STRIPE_PRICE_ENTERPRISE.
 * enterprise-deploy is contact-sales and has no Stripe price.
 */
export function priceIdForTier(tier: string): string | null {
  const envKey = PRICE_ENV_MAP[tier as BillingTier];
  if (!envKey) return null;
  return process.env[envKey] ?? null;
}

// ---------------------------------------------------------------------------
// Embedded card collection (Payment Element + SetupIntent + trialing sub)
//
// Card-first signup (epic card-first-signup, dashboard#767/#769). Replaces
// the hosted-Checkout redirect: the SetupIntent client secret drives an
// in-page Payment Element, and once the card is confirmed client-side the
// trialing subscription is created server-side with that payment method.
// ---------------------------------------------------------------------------

/**
 * Find-or-create the Stripe customer for a card-first signup, BEFORE any
 * account or Tenant CR exists (dashboard#785). The customer is created up
 * front so the card can be collected and the trialing subscription created
 * before we provision anything — nothing is created until the card clears.
 *
 * Reuse-by-email: a retried/abandoned signup for the same email reuses the
 * prior `signup_pending` customer instead of minting a duplicate (the
 * orphan-dupe / 21k-leak class, to#354). Stripe search is eventually
 * consistent, so this is best-effort dedup; the AUTHORITATIVE customer for a
 * completed signup is the one pinned on the Tenant CR annotation, which the
 * operator saga adopts deterministically (no search race).
 *
 * Tagged with `metadata.tenant_id` = slug so the saga's adoption path and the
 * webhook tenant attribution both resolve.
 */
export interface SignupCustomerParams {
  email: string;
  name: string;
  tenantSlug: string;
  tier: string;
}

function escapeStripeQuery(v: string): string {
  return v.replace(/['\\]/g, '\\$&');
}

export async function findOrCreateSignupCustomer(
  params: SignupCustomerParams,
): Promise<string> {
  const stripe = getStripeClient();
  const metadata = {
    tenant_id: params.tenantSlug,
    tier: params.tier,
    signup_pending: 'true',
    email: params.email,
  };
  try {
    const found = await stripe.customers.search({
      query: `email:'${escapeStripeQuery(params.email)}' AND metadata['signup_pending']:'true'`,
      limit: 1,
    });
    const existing = found.data[0];
    if (existing) {
      // Refresh name/tier/tenant in case the user changed company or plan on retry.
      await stripe.customers.update(existing.id, { name: params.name, metadata });
      return existing.id;
    }
  } catch {
    // Search unavailable (e.g. stripe-mock has no /v1/customers/search) — fall
    // through to create. Worst case is a reusable-later pending customer.
  }
  const created = await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata,
  });
  return created.id;
}

/**
 * Verify a client-supplied customer id really belongs to this signup's email
 * before we create a subscription against it (phase 2 receives the id from the
 * browser, so it is untrusted). Returns false on any mismatch / deleted /
 * missing customer.
 */
export async function verifySignupCustomer(
  customerId: string,
  email: string,
): Promise<boolean> {
  const stripe = getStripeClient();
  try {
    const c = await stripe.customers.retrieve(customerId);
    if (c.deleted) return false;
    return (c.email ?? '').toLowerCase() === email.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Clear the `signup_pending` tag once provisioning is underway, so a later
 * unrelated signup with the same email never reuses this now-owned customer.
 * Best-effort: a failure here does not fail the signup.
 */
export async function finalizeSignupCustomer(customerId: string): Promise<void> {
  const stripe = getStripeClient();
  try {
    await stripe.customers.update(customerId, { metadata: { signup_pending: 'false' } });
  } catch {
    // non-fatal
  }
}

/** Parameters for the embedded SetupIntent that backs the Payment Element. */
export interface SetupIntentParams {
  /** Stripe customer ID (cus_...) the card is attached to. */
  customerId: string;
  /** Tenant slug, carried in metadata for traceability. */
  tenantSlug: string;
  /** Idempotency key for the Stripe API call. */
  idempotencyKey: string;
}

/**
 * Create a SetupIntent for in-page card collection. usage=off_session so the
 * collected card can be charged when the trial ends. The returned
 * client_secret is handed to the browser's Payment Element; card data is
 * collected by Stripe.js and never reaches our servers.
 */
export async function createSetupIntent(
  params: SetupIntentParams,
): Promise<Stripe.SetupIntent> {
  const stripe = getStripeClient();
  return stripe.setupIntents.create(
    {
      customer: params.customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: { tenantId: params.tenantSlug },
    },
    { idempotencyKey: params.idempotencyKey },
  );
}

/** Parameters for creating the trialing subscription after card confirmation. */
export interface TrialingSubscriptionParams {
  /** Self-serve tier (not contact-sales). */
  tier: BillingTier;
  /** Stripe Price ID for the tier. */
  priceId: string;
  /** Stripe customer ID (cus_...). */
  customerId: string;
  /** Payment method id (pm_...) confirmed by the Payment Element's SetupIntent. */
  paymentMethodId: string;
  /** Trial length in days, sourced from the plan registry (no hardcoded default). */
  trialPeriodDays: number;
  /** Tenant slug for client_reference_id-equivalent metadata. */
  tenantSlug: string;
  /** Idempotency key — same tenant must not yield two subscriptions. */
  idempotencyKey: string;
}

/**
 * Create the trialing subscription once the Payment Element has confirmed the
 * card. The confirmed payment method becomes the subscription default, so the
 * customer is charged automatically when the trial ends. The subscription
 * carries a `trial_signup` metadata marker so Stripe Radar can score trial
 * starts on the SetupIntent path (hosted Checkout would auto-detect this;
 * the embedded path must tag it).
 *
 * @throws If called with a contact-sales tier.
 */
export async function createTrialingSubscription(
  params: TrialingSubscriptionParams,
): Promise<Stripe.Subscription> {
  if (CONTACT_SALES_TIERS.has(params.tier)) {
    throw new Error(
      `[billing/stripe] createTrialingSubscription called with contact-sales tier "${params.tier}". ` +
        'Enterprise tiers must go through the sales flow.',
    );
  }
  const stripe = getStripeClient();
  return stripe.subscriptions.create(
    {
      customer: params.customerId,
      items: [{ price: params.priceId }],
      trial_period_days: params.trialPeriodDays,
      default_payment_method: params.paymentMethodId,
      trial_settings: {
        end_behavior: { missing_payment_method: 'cancel' },
      },
      metadata: {
        tenantId: params.tenantSlug,
        tier: params.tier,
        trial_signup: 'true',
      },
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
 * Find the customer's current (most relevant) subscription.
 *
 * Returns the first trialing subscription if one exists, otherwise the first
 * active subscription, otherwise the most recent subscription of any status,
 * or null when the customer has none. Used by the trial-extension admin route
 * which — post dashboard#813 — resolves the subscription via the Stripe
 * customer id (from the daemon provisioning snapshot) rather than reading the
 * Tenant CR's status.billing.subscriptionId directly.
 */
export async function findCustomerSubscription(
  customerId: string,
): Promise<Stripe.Subscription | null> {
  const stripe = getStripeClient();
  const { data } = await stripe.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  });
  if (data.length === 0) return null;
  return (
    data.find((s) => s.status === 'trialing') ??
    data.find((s) => s.status === 'active') ??
    data[0]
  );
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
    // Card-first signup: the in-page Payment Element calls loadStripe() with
    // this runtime-injected key. Absent → the Element never mounts and the
    // signup CTA stays unclickable (dashboard#783). Fail loud at boot instead.
    'STRIPE_PUBLISHABLE_KEY',
    // One env var per paid tier. Validated at startup; missing in dev or
    // free-tier-only deployments → set DASHBOARD_BILLING_PAID_TIERS_ENABLED
    // to false to skip this check entirely.
    // Generated env-var names; one per Stripe-priced tier (not contact-sales).
    ...BILLING_TIER_IDS.map((t) => PRICE_ENV_MAP[t]),
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
  // The key VALUE is never logged, only whether it starts with sk_test_ or sk_live_.
  // STRIPE_SECRET_KEY presence already required above; the `?? ''` is a
  // narrow defensive coercion (not a silent default) so .startsWith() is safe.
  const secretKey = process.env.STRIPE_SECRET_KEY ?? '';

  // Card-first-signup mode guard (dashboard#767). The chart declares the
  // environment's billing mode explicitly via STRIPE_EXPECTED_MODE
  // (test on staging — dummy cards only; live in prod — real cards), so we
  // assert the key prefix directly instead of inferring from NODE_ENV. This
  // is the authoritative check: staging gets test-card-only safety WITHOUT
  // the NODE_ENV/allowTestKey dance below, and a mis-mounted key fails the
  // pod at boot. Required whenever paid tiers are on.
  const expectedMode = process.env.STRIPE_EXPECTED_MODE;
  if (!expectedMode) {
    throw new Error(
      '[billing/stripe] STRIPE_EXPECTED_MODE is required when paid tiers are enabled ' +
        '(epic card-first-signup / dashboard#767): set "test" (staging) or "live" (prod).',
    );
  }
  if (expectedMode !== 'test' && expectedMode !== 'live') {
    throw new Error(
      `[billing/stripe] STRIPE_EXPECTED_MODE must be "test" or "live", got "${expectedMode}".`,
    );
  }
  const keyMode = secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')
    ? 'test'
    : secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')
      ? 'live'
      : null;
  if (keyMode === null) {
    throw new Error(
      '[billing/stripe] STRIPE_SECRET_KEY has an unrecognised prefix; ' +
        'cannot determine test vs live for the card-first-signup mode guard.',
    );
  }
  if (keyMode !== expectedMode) {
    throw new Error(
      `[billing/stripe] Stripe key/mode mismatch: STRIPE_EXPECTED_MODE="${expectedMode}" ` +
        `but the key is ${keyMode}-mode — refusing to boot (the wrong cards would be accepted).`,
    );
  }

  // The publishable key powers the in-page Payment Element (card-first signup,
  // dashboard#783). It is runtime-injected (STRIPE_PUBLISHABLE_KEY, server-side)
  // so one image serves both staging (pk_test) and prod (pk_live). Assert its
  // mode matches STRIPE_EXPECTED_MODE too, so a mis-mounted pk fails the pod at
  // boot rather than silently targeting the wrong Stripe environment.
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY ?? '';
  const pubMode = publishableKey.startsWith('pk_test_')
    ? 'test'
    : publishableKey.startsWith('pk_live_')
      ? 'live'
      : null;
  if (pubMode === null) {
    throw new Error(
      '[billing/stripe] STRIPE_PUBLISHABLE_KEY has an unrecognised prefix; ' +
        'expected pk_test_ or pk_live_ for the card-first-signup Payment Element.',
    );
  }
  if (pubMode !== expectedMode) {
    throw new Error(
      `[billing/stripe] Stripe publishable-key/mode mismatch: STRIPE_EXPECTED_MODE="${expectedMode}" ` +
        `but STRIPE_PUBLISHABLE_KEY is ${pubMode}-mode — refusing to boot (the Payment Element would target the wrong Stripe environment).`,
    );
  }

  // NOTE: the prior NODE_ENV-inferred guard (+ STRIPE_ALLOW_TEST_KEY opt-in
  // for staging's NODE_ENV=production/test-key combination) is intentionally
  // gone. STRIPE_EXPECTED_MODE is the explicit, authoritative declaration of
  // the environment's billing mode (dashboard#767), so staging no longer
  // needs the allowTestKey escape hatch and there is no second, NODE_ENV-based
  // codepath enforcing the same invariant (ADR-0027 — no parallel codepaths).
}
