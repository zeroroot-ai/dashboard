/**
 * pricing-display.ts — Converts the canonical Plan shape (from
 * @/src/generated/plans) into the display-oriented struct the pricing page
 * and BillingContent consume.
 *
 * The canonical registry stores quotas as integers with -1 meaning unlimited.
 * This module formats them as the human strings the pricing UI expects
 * ("50 GB", "60 days", "Unlimited", etc.), and derives "priority" slack
 * variants based on plan position.
 *
 * No other file should format plan quota strings; route every display
 * derivation through here so future plan tweaks land in one place.
 */

import type { Plan, PlanID } from "@/src/generated/plans";
import { plans } from "@/src/generated/plans";

export type BooleanFeature = true | false | "priority";

export interface PricingTierDisplay {
  id: PlanID;
  name: string;
  tagline: string;
  persona: string;

  monthlyPrice: number | null;
  annualPrice: number | null;
  contactOnly: boolean;
  annualSavingsPct: number | null;

  includedSeats: number | "Unlimited";
  perSeatBase: number | null;
  perSeatOverage: number | null;

  concurrentAgents: number | "Unlimited";
  graphStorage: string;
  retention: string;
  sandboxLaunchesPerMonth: string;

  sso: BooleanFeature;
  auditLogs: BooleanFeature;
  complianceExports: BooleanFeature;
  dedicatedSlack: BooleanFeature;
  dedicatedTenant: BooleanFeature | "n/a";
  privateRegistry: BooleanFeature;

  deployment: string;
  responseSla: string;

  additionalNotes: string[];
  isMostPopular: boolean;

  /**
   * Derived checkout mode for this tier.
   *
   * - `"self-serve"`: paid tiers that go through Stripe Checkout (squad/org/platform).
   * - `"contact-sales"`: tiers that require a sales conversation (enterprise-cloud/
   *   enterprise-onprem/public-sector).
   * - `"free"`: the solo tier which has no checkout flow.
   *
   * Derived in `toPricingTierDisplay` from `selfServeTierIds` / `contactTierIds`.
   * Not stored in the canonical plans YAML or the generated plans registry.
   */
  stripeMode: "self-serve" | "contact-sales" | "free";

  cta: {
    label: string;
    /**
     * href is only meaningful for contact-sales and free tiers.
     * For self-serve tiers, CheckoutButton handles the redirect — href is
     * an empty string and should not be used as a navigation target.
     */
    href: string;
    variant: "default" | "outline" | "secondary";
  };
}

function formatSeats(seats: number): number | "Unlimited" {
  return seats === -1 ? "Unlimited" : seats;
}

function formatConcurrent(n: number): number | "Unlimited" {
  return n === -1 ? "Unlimited" : n;
}

function formatStorage(gb: number): string {
  if (gb === -1) return "Unlimited";
  if (gb >= 1000) {
    const tb = gb / 1000;
    return Number.isInteger(tb) ? `${tb} TB` : `${tb.toFixed(1)} TB`;
  }
  return `${gb} GB`;
}

function formatDays(days: number): string {
  return days === -1 ? "Unlimited" : `${days} days`;
}

function formatSandboxLaunches(n: number, id: PlanID): string {
  if (n === -1) {
    // Reflect the pre-migration copy: enterprise-cloud says "Fair use", the
    // other unlimited tiers say "Unlimited".
    return id === "enterprise-cloud" ? "Fair use" : "Unlimited";
  }
  return n.toLocaleString("en-US");
}

/**
 * Promotes has_dedicated_slack=true to the "priority" variant for the org
 * tier, matching the pre-migration pricing page copy ("Priority Slack").
 * Platform and enterprise tiers get full "Dedicated Slack".
 */
function deriveDedicatedSlack(plan: Plan): BooleanFeature {
  if (!plan.features.has_dedicated_slack) return false;
  if (plan.id === "org") return "priority";
  return true;
}

/**
 * For presentation: the enterprise-onprem / public-sector tiers render
 * dedicatedTenant as "n/a" since the tenant is the customer's own cluster.
 */
function deriveDedicatedTenant(plan: Plan): BooleanFeature | "n/a" {
  if (plan.id === "enterprise-onprem" || plan.id === "public-sector") {
    return "n/a";
  }
  return plan.features.has_dedicated_tenant;
}

/**
 * Derive the checkout mode for a plan ID.
 *
 * - `solo` is the free tier (no checkout).
 * - `squad`, `org`, `platform` are paid self-serve tiers handled by Stripe Checkout.
 * - `enterprise-cloud`, `enterprise-onprem`, `public-sector` require a sales conversation.
 *
 * Inlined here (not referencing the exported constants below) so that
 * `toPricingTierDisplay` is usable at module-init time before the constants
 * are bound.
 */
function deriveStripeMode(
  planId: PlanID,
): "self-serve" | "contact-sales" | "free" {
  const id = planId as string;
  if (id === "solo") return "free";
  if (id === "squad" || id === "org" || id === "platform") return "self-serve";
  if (
    id === "enterprise-cloud" ||
    id === "enterprise-onprem" ||
    id === "public-sector"
  ) {
    return "contact-sales";
  }
  // Fallback: treat unknown plans as contact-sales for safety.
  return "contact-sales";
}

/**
 * Convert a canonical Plan into the display struct used by the /pricing
 * page. This function is pure; it does not consult any runtime state.
 */
export function toPricingTierDisplay(plan: Plan): PricingTierDisplay {
  const stripeMode = deriveStripeMode(plan.id);

  return {
    id: plan.id,
    name: plan.displayName,
    tagline: plan.tagline,
    persona: plan.persona,

    monthlyPrice: plan.monthlyPrice,
    annualPrice: plan.annualPrice,
    contactOnly: plan.contactOnly,
    annualSavingsPct: plan.annualSavingsPct,

    includedSeats: formatSeats(plan.quotas.seats),
    perSeatBase: plan.perSeatBase ?? null,
    perSeatOverage: plan.perSeatOverage ?? null,

    concurrentAgents: formatConcurrent(plan.quotas.concurrent_agents),
    graphStorage: formatStorage(plan.quotas.storage_gb),
    retention: formatDays(plan.quotas.retention_days),
    sandboxLaunchesPerMonth: formatSandboxLaunches(
      plan.quotas.sandbox_launches_per_month,
      plan.id,
    ),

    sso: plan.features.has_sso,
    auditLogs: plan.features.has_audit_logs,
    complianceExports: plan.features.has_compliance_exports,
    dedicatedSlack: deriveDedicatedSlack(plan),
    dedicatedTenant: deriveDedicatedTenant(plan),
    privateRegistry: plan.features.has_private_registry,

    deployment: plan.deployment ?? "",
    responseSla: plan.responseSla ?? "",

    additionalNotes: plan.additionalNotes ?? [],
    isMostPopular: plan.isMostPopular ?? false,

    stripeMode,

    cta: {
      label: plan.cta?.label ?? "",
      // For self-serve tiers, CheckoutButton handles the redirect — href is
      // intentionally empty. Contact-sales and free tiers keep their href.
      href: stripeMode === "self-serve" ? "" : (plan.cta?.href ?? ""),
      variant: (plan.cta?.variant ?? "default") as
        | "default"
        | "outline"
        | "secondary",
    },
  };
}

/**
 * All plans rendered as pricing displays, in pricing-page order.
 */
export const pricingDisplays: readonly PricingTierDisplay[] = Object.freeze(
  plans.map(toPricingTierDisplay),
);

export const selfServeTierIds: readonly PlanID[] = Object.freeze([
  "solo",
  "squad",
  "org",
  "platform",
]);

export const contactTierIds: readonly PlanID[] = Object.freeze([
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
]);
