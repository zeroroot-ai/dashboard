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

export const PRICE_ENV_MAP: Readonly<Record<BillingTier, string>> = Object.freeze({
  "team": "STRIPE_PRICE_TEAM",
  "org": "STRIPE_PRICE_ORG",
  "enterprise": "STRIPE_PRICE_ENTERPRISE",
});

// CONTACT_SALES_TIERS is the closed set of plan ids that route to a
// contact-sales form rather than a Stripe checkout. Generated from
// plans.yaml entries where pricing.contactSales === true.
export const CONTACT_SALES_TIERS: readonly string[] = Object.freeze([
  "enterprise-deploy",
]) as readonly string[];
