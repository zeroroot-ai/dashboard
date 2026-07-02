// GENERATED FILE, do not edit.
// Source: enterprise/deploy/helm/gibson-operators/files/plans.yaml
// Generator: enterprise/platform/dashboard/scripts/gen-stripe-tiers.mjs
// Spec: plans-and-quotas-simplification R8.

export type BillingTier =
  | "team"
  | "org"
  | "enterprise";

export const BILLING_TIER_IDS: readonly BillingTier[] = Object.freeze([
  "team",
  "org",
  "enterprise",
]) as readonly BillingTier[];

// LOOKUP_KEY_MAP maps each self-serve tier to its stable Stripe lookup_key.
// Lookup keys are identical across every Stripe account and test/live mode,
// so no per-environment STRIPE_PRICE_* env vars are needed. The dashboard
// resolves the live price ID at runtime via prices.list({lookup_keys:[...]}).
export const LOOKUP_KEY_MAP: Readonly<Record<BillingTier, string>> = Object.freeze({
  "team": "gibson_team_monthly_usd",
  "org": "gibson_org_monthly_usd",
  "enterprise": "gibson_enterprise_monthly_usd",
});

// CONTACT_SALES_TIERS is the closed set of plan ids that route to a
// contact-sales form rather than a Stripe checkout. Generated from
// plans.yaml entries where pricing.contactSales === true.
export const CONTACT_SALES_TIERS: readonly string[] = Object.freeze([
  "enterprise-deploy",
]) as readonly string[];
