/**
 * billing-enabled.ts — the single source of truth for "does this dashboard
 * have a Stripe-backed billing backend?".
 *
 * Open-core context (ADR-0050, dashboard#809): gibson#798 ripped
 * BillingService / Stripe / plans out of the OSS daemon; the closed billing
 * implementation lives in the (future) closed billing layer. On-prem /
 * self-host runs WITHOUT billing — it operates on the config-driven
 * Entitlements default. The hosted offering wires in the closed billing
 * service.
 *
 * This flag gates the *purchase / manage* billing UI (Stripe checkout,
 * subscription management, customer portal, upgrade CTAs). It does NOT gate
 * plan/tier DISPLAY (from src/generated/plans.ts) or entitlement/quota
 * display — those are always present regardless of whether billing is wired.
 *
 * Backing env: `DASHBOARD_BILLING_PAID_TIERS_ENABLED` (the pre-existing
 * billing master switch — see src/lib/env-validator.ts and
 * src/lib/billing/stripe.ts:validateBillingConfig). We deliberately reuse it
 * rather than introduce a second flag that could drift out of sync.
 *
 * Fail-closed: an absent / unrecognised value means billing is OFF. This is
 * the on-prem default — a self-host deploy that simply doesn't set the var
 * gets the no-billing surface, never a half-wired checkout that 500s.
 *
 * Server-only: the flag is read at RUNTIME (the shared :main image can't bake
 * a per-env value, same reasoning as STRIPE_PUBLISHABLE_KEY in
 * env-validator.ts). Client components receive the resolved boolean as a prop
 * from their nearest server boundary — do NOT add a NEXT_PUBLIC_* mirror.
 */

import 'server-only';

/**
 * True when the dashboard is wired to a Stripe-backed billing backend
 * (hosted offering). False on-prem / self-host (the default).
 */
export function billingEnabled(): boolean {
  const v = process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
  return v === 'true' || v === '1';
}
