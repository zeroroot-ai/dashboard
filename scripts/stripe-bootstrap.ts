#!/usr/bin/env ts-node
/**
 * stripe-bootstrap.ts — One-time Stripe environment bootstrap script.
 *
 * Creates (or updates) the Stripe Customer Portal configuration for a
 * Gibson Stripe account (test or live mode). Run once per Stripe account
 * at environment bootstrap time; safe to re-run (idempotent).
 *
 * Usage:
 *   npx ts-node scripts/stripe-bootstrap.ts --test   # test mode (sk_test_...)
 *   npx ts-node scripts/stripe-bootstrap.ts --live   # live mode (sk_live_...)
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY   — Stripe API key for the target mode.
 *
 * Product IDs for the portal features:
 *   STRIPE_PRODUCT_SQUAD, STRIPE_PRODUCT_ORG, STRIPE_PRODUCT_PLATFORM
 *   (optional — omit to skip subscription-update product list)
 *
 * On success: prints the configuration ID (bpc_...) to stdout.
 * Paste this value into the Helm chart as dashboard.billing.portalConfigurationId.
 *
 * Spec: stripe-billing-integration R3.2, design open item 5.
 */

import { getStripeClient } from '../src/lib/billing/stripe';

type Stripe = typeof import('stripe').default.prototype;

const STRIPE_PORTAL_FEATURES = {
  // Allow customers to cancel their subscription.
  subscription_cancel: { enabled: true },
  // Allow customers to update their payment method.
  payment_method_update: { enabled: true },
  // Allow customers to view their invoices.
  invoice_history: { enabled: true },
  // Allow customers to update their billing address.
  customer_update: {
    enabled: true,
    allowed_updates: ['email', 'tax_id'] as const,
  },
};

async function main() {
  const mode = process.argv[2];
  if (mode !== '--test' && mode !== '--live') {
    console.error('Usage: npx ts-node scripts/stripe-bootstrap.ts --test | --live');
    process.exit(1);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }

  if (mode === '--test' && !key.startsWith('sk_test_')) {
    console.error('--test mode requires a sk_test_... key. Got a non-test key.');
    process.exit(1);
  }
  if (mode === '--live' && !key.startsWith('sk_live_')) {
    console.error('--live mode requires a sk_live_... key. Got a non-live key.');
    process.exit(1);
  }

  console.log(`Bootstrapping Stripe portal configuration in ${mode === '--test' ? 'TEST' : 'LIVE'} mode...`);

  const stripe = getStripeClient() as unknown as Stripe;

  // Check if a portal configuration already exists.
  const existing = await (stripe.billingPortal as { configurations: { list: () => Promise<{ data: Array<{ id: string; active: boolean; created: number }> }> } }).configurations.list();

  // Sort by created (most recent first) and find the active one.
  const activeConfigs = existing.data.filter((c) => c.active);
  activeConfigs.sort((a, b) => b.created - a.created);

  let configId: string;
  let action: 'created' | 'updated';

  // Build the product list from env vars (optional).
  const productIds = [
    process.env.STRIPE_PRODUCT_SQUAD,
    process.env.STRIPE_PRODUCT_ORG,
    process.env.STRIPE_PRODUCT_PLATFORM,
  ].filter(Boolean) as string[];

  const subscriptionUpdateConfig = productIds.length > 0
    ? {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price', 'quantity', 'promotion_code'] as const,
          products: productIds.map((id) => ({ product: id, prices: [] as string[] })),
        } as Record<string, unknown>,
      }
    : {};

  const features = {
    ...STRIPE_PORTAL_FEATURES,
    ...subscriptionUpdateConfig,
  };

  if (activeConfigs.length > 0) {
    // Update the most recent active configuration.
    const existingId = activeConfigs[0].id;
    console.log(`Found existing portal configuration: ${existingId}. Updating...`);

    await (stripe.billingPortal as { configurations: { update: (id: string, params: Record<string, unknown>) => Promise<{ id: string }> } }).configurations.update(existingId, {
      features,
      business_profile: {
        headline: 'Gibson — AI Security Research Platform',
        privacy_policy_url: 'https://zero-day.ai/privacy',
        terms_of_service_url: 'https://zero-day.ai/terms',
      },
    });

    configId = existingId;
    action = 'updated';
  } else {
    // Create a new portal configuration.
    console.log('No existing portal configuration found. Creating...');

    const config = await (stripe.billingPortal as unknown as { configurations: { create: (params: Record<string, unknown>) => Promise<{ id: string }> } }).configurations.create({
      features,
      business_profile: {
        headline: 'Gibson — AI Security Research Platform',
        privacy_policy_url: 'https://zero-day.ai/privacy',
        terms_of_service_url: 'https://zero-day.ai/terms',
      },
    });

    configId = config.id;
    action = 'created';
  }

  console.log('');
  console.log(`✓ Portal configuration ${action}: ${configId}`);
  console.log('');
  console.log('Paste this into your Helm values:');
  console.log(`  dashboard.billing.portalConfigurationId: "${configId}"`);
  console.log('');
  console.log('Or set the env var:');
  console.log(`  STRIPE_PORTAL_CONFIGURATION_ID=${configId}`);
}

main().catch((err) => {
  console.error('Bootstrap failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
