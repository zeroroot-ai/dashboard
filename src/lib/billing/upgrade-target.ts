/**
 * upgrade-target.ts, Tier-aware upgrade routing for the in-app quota
 * UX. Spec plans-and-quotas-simplification R9.B.6.
 *
 * - team               → "Upgrade to Org"        (Stripe portal)
 * - org                → "Upgrade to Enterprise" (Stripe portal)
 * - enterprise         → "Talk to sales"         (contact form)
 * - enterprise-deploy  → null (no upgrade path; widget renders no CTA)
 */

import type { PlanID } from "@/src/generated/plans";

export type UpgradeTarget = {
  label: string;
  href: string;
} | null;

export function getUpgradeTarget(plan: PlanID | string | undefined): UpgradeTarget {
  switch (plan) {
    case "team":
      return { label: "Upgrade to Org", href: "/billing/upgrade?target=org" };
    case "org":
      return { label: "Upgrade to Enterprise", href: "/billing/upgrade?target=enterprise" };
    case "enterprise":
      return { label: "Talk to sales", href: "/contact-sales?reason=enterprise-upgrade" };
    case "enterprise-deploy":
      return null;
    default:
      return null;
  }
}
