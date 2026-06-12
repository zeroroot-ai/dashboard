/**
 * pricing-display.ts, formats a generated Plan for the pricing UI.
 *
 * Spec plans-and-quotas-simplification simplifies this to the two enforced
 * quotas and a small pricing block. No more vibes-features bullet list.
 */

import type { Plan, PlanID } from "@/src/generated/plans";
import { plans } from "@/src/generated/plans";

export interface PricingTierDisplay {
  id: PlanID;
  name: string;
  tagline: string;
  /** Headline price string ("$99/mo", "$24,000/yr", "Contact sales"). */
  priceLabel: string;
  /** Optional secondary price string ("billed annually"). */
  priceSubLabel: string | null;
  /** "Save 17%" / "", the savings badge. */
  annualSavings: string | null;
  /** Two enforced quotas formatted for display. 0 → "Unlimited". */
  concurrentMissionsLabel: string;
  concurrentAgentsLabel: string;
  /** True for plans whose CTA routes to a contact-sales form. */
  contactSales: boolean;
}

function formatQuota(value: number, noun: string): string {
  if (value === 0) return "Unlimited";
  return `${value.toLocaleString()} ${noun}`;
}

function dollars(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatPriceLabel(p: Plan): { label: string; sub: string | null } {
  if (p.pricing.contactSales) {
    return { label: "Contact sales", sub: null };
  }
  if (typeof p.pricing.monthlyUSD === "number") {
    return {
      label: `${dollars(p.pricing.monthlyUSD)}/mo`,
      sub:
        typeof p.pricing.annualUSD === "number"
          ? `or ${dollars(p.pricing.annualUSD)}/yr (billed annually)`
          : null,
    };
  }
  if (typeof p.pricing.annualUSD === "number") {
    return { label: `${dollars(p.pricing.annualUSD)}/yr`, sub: "billed annually" };
  }
  return { label: "Contact sales", sub: null };
}

export function planToDisplay(p: Plan): PricingTierDisplay {
  const { label, sub } = formatPriceLabel(p);
  const savings =
    typeof p.pricing.annualSavingsPct === "number" && p.pricing.annualSavingsPct > 0
      ? `Save ${p.pricing.annualSavingsPct}%`
      : null;
  return {
    id: p.id,
    name: p.displayName,
    tagline: p.tagline,
    priceLabel: label,
    priceSubLabel: sub,
    annualSavings: savings,
    concurrentMissionsLabel: formatQuota(p.quotas.concurrent_missions, "concurrent missions"),
    concurrentAgentsLabel: formatQuota(p.quotas.concurrent_agents, "concurrent agents"),
    contactSales: !!p.pricing.contactSales,
  };
}

/** All plans for the pricing page, in registry order. */
export const pricingDisplays: readonly PricingTierDisplay[] = plans.map(planToDisplay);

/**
 * selfServeTierIds is the list of plan ids whose signup flow proceeds via
 * self-serve (Stripe checkout) rather than a contact-sales form. The
 * signup page allow-lists `?plan=` against this set.
 */
export const selfServeTierIds: readonly string[] = pricingDisplays
  .filter((d) => !d.contactSales)
  .map((d) => d.id);

/**
 * contactTierIds, plan ids whose signup flow routes to a contact-sales
 * form rather than a Stripe checkout. Used by the billing checkout
 * route to reject contact-only tiers.
 */
export const contactTierIds: readonly string[] = pricingDisplays
  .filter((d) => d.contactSales)
  .map((d) => d.id);
