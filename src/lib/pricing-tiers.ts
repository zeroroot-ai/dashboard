/**
 * Public-facing pricing-tier config for the `/pricing` page.
 *
 * This is intentionally SEPARATE from `src/lib/plans.ts` (the internal
 * billing/tier-limits registry). The internal rename from
 * indie/team/business/enterprise → solo/squad/org/platform/enterprise-cloud/
 * enterprise-onprem/federal is tracked in spec `pricing-tier-overhaul` and
 * needs to propagate through Stripe SKUs, tier-checker thresholds, the
 * tenant-operator CRD enum, BillingContent, useTierLimits, and e2e fixtures.
 *
 * Until that spec lands, self-serve tier cards on /pricing link to
 * `/signup?plan=<signupPlanId>` using the legacy plan ID so signup and
 * billing keep working unchanged.
 */
export type PricingTierId =
  | "solo"
  | "squad"
  | "org"
  | "platform"
  | "enterprise-cloud"
  | "enterprise-onprem"
  | "public-sector";

export type BooleanFeature = true | false | "priority";

export interface PricingTier {
  id: PricingTierId;
  name: string;
  tagline: string;
  persona: string;

  // Pricing
  monthlyPrice: number | null; // null => no monthly option (enterprise-cloud) OR contact-sales
  annualPrice: number | null; // null => contact-sales
  contactOnly: boolean; // true => hide dollar amount entirely
  annualSavingsPct: number | null; // for "Save N%" badge on this tier

  // Seats
  includedSeats: number | "Unlimited";
  perSeatBase: number | null;
  perSeatOverage: number | null;

  // Quotas
  concurrentAgents: number | "Unlimited" | string; // "2,000+ (negotiable)"
  graphStorage: string; // "50 GB", "5 TB", "Unlimited"
  retention: string; // "60 days", "Unlimited"
  sandboxLaunchesPerMonth: string; // "500", "Fair use", "Unlimited"

  // Features
  sso: BooleanFeature;
  auditLogs: BooleanFeature;
  complianceExports: BooleanFeature;
  dedicatedSlack: BooleanFeature;
  dedicatedTenant: BooleanFeature | "n/a";
  privateRegistry: BooleanFeature;

  // Ops
  deployment: string;
  responseSla: string;

  // Extras
  additionalNotes: string[];

  // UI
  isMostPopular: boolean;
  cta: {
    label: string;
    href: string; // self-serve: /signup?plan=<legacy>; contact: /contact-sales?tier=<id>
    variant: "default" | "outline" | "secondary";
  };
}

export const pricingTiers: PricingTier[] = [
  {
    id: "solo",
    name: "Solo",
    tagline: "For bug bounty hunters and independent researchers",
    persona: "Bug bounty hunter or solo researcher",
    monthlyPrice: 249,
    annualPrice: 2988,
    contactOnly: false,
    annualSavingsPct: 0,
    includedSeats: 1,
    perSeatBase: null,
    perSeatOverage: null,
    concurrentAgents: 10,
    graphStorage: "50 GB",
    retention: "60 days",
    sandboxLaunchesPerMonth: "500",
    sso: false,
    auditLogs: false,
    complianceExports: false,
    dedicatedSlack: false,
    dedicatedTenant: false,
    privateRegistry: false,
    deployment: "Shared cloud",
    responseSla: "Email, 72h response",
    additionalNotes: [],
    isMostPopular: false,
    cta: {
      label: "Start trial",
      href: "/signup?plan=indie",
      variant: "outline",
    },
  },
  {
    id: "squad",
    name: "Squad",
    tagline: "For small offensive teams and boutique shops",
    persona: "Small offensive team, boutique shop, or independent red teamer",
    monthlyPrice: 1499,
    annualPrice: 17088,
    contactOnly: false,
    annualSavingsPct: 5,
    includedSeats: 5,
    perSeatBase: 299,
    perSeatOverage: 249,
    concurrentAgents: 50,
    graphStorage: "500 GB",
    retention: "180 days",
    sandboxLaunchesPerMonth: "5,000",
    sso: false,
    auditLogs: false,
    complianceExports: false,
    dedicatedSlack: false,
    dedicatedTenant: false,
    privateRegistry: false,
    deployment: "Shared cloud",
    responseSla: "Slack channel, 24h response",
    additionalNotes: [],
    isMostPopular: false,
    cta: {
      label: "Start trial",
      href: "/signup?plan=team",
      variant: "default",
    },
  },
  {
    id: "org",
    name: "Org",
    tagline: "For internal red teams, DevSecOps groups, and SRE teams",
    persona: "Internal red team, DevSecOps, or SRE",
    monthlyPrice: 4999,
    annualPrice: 56989,
    contactOnly: false,
    annualSavingsPct: 5,
    includedSeats: 20,
    perSeatBase: 249,
    perSeatOverage: 179,
    concurrentAgents: 250,
    graphStorage: "5 TB",
    retention: "365 days",
    sandboxLaunchesPerMonth: "50,000",
    sso: true,
    auditLogs: true,
    complianceExports: false,
    dedicatedSlack: "priority",
    dedicatedTenant: false,
    privateRegistry: true,
    deployment: "Shared cloud",
    responseSla: "Priority Slack, 8h response",
    additionalNotes: [
      "Private mission/tool/agent registry",
      "Custom tool onboarding",
    ],
    isMostPopular: true,
    cta: {
      label: "Start trial",
      href: "/signup?plan=business",
      variant: "default",
    },
  },
  {
    id: "platform",
    name: "Platform",
    tagline: "For SOC, IR, and AppSec operations",
    persona: "SOC, IR, or AppSec operations",
    monthlyPrice: 12000,
    annualPrice: 136800,
    contactOnly: false,
    annualSavingsPct: 5,
    includedSeats: 50,
    perSeatBase: 240,
    perSeatOverage: 149,
    concurrentAgents: 750,
    graphStorage: "25 TB",
    retention: "730 days",
    sandboxLaunchesPerMonth: "200,000",
    sso: true,
    auditLogs: true,
    complianceExports: true,
    dedicatedSlack: true,
    dedicatedTenant: false,
    privateRegistry: true,
    deployment: "Shared cloud",
    responseSla: "Dedicated Slack, 4h response",
    additionalNotes: ["Quarterly business reviews"],
    isMostPopular: false,
    cta: {
      label: "Start trial",
      href: "/signup?plan=business",
      variant: "default",
    },
  },
  {
    id: "enterprise-cloud",
    name: "White Label On-Prem",
    tagline: "Dedicated infrastructure for regulated buyers",
    persona: "Regulated buyer with compliance requirements",
    monthlyPrice: null,
    annualPrice: null,
    contactOnly: true,
    annualSavingsPct: null,
    includedSeats: "Unlimited",
    perSeatBase: null,
    perSeatOverage: null,
    concurrentAgents: "Unlimited",
    graphStorage: "Unlimited",
    retention: "Unlimited",
    sandboxLaunchesPerMonth: "Fair use",
    sso: true,
    auditLogs: true,
    complianceExports: true,
    dedicatedSlack: true,
    dedicatedTenant: true,
    privateRegistry: true,
    deployment: "Dedicated cloud",
    responseSla: "Dedicated Slack, 2h response",
    additionalNotes: [],
    isMostPopular: false,
    cta: {
      label: "Contact sales",
      href: "/contact-sales?tier=enterprise-cloud",
      variant: "secondary",
    },
  },
  {
    id: "enterprise-onprem",
    name: "Enterprise On-Prem",
    tagline: "Gibson and Setec in your Kubernetes cluster",
    persona: "Need on-prem deployment",
    monthlyPrice: null,
    annualPrice: null,
    contactOnly: true,
    annualSavingsPct: null,
    includedSeats: "Unlimited",
    perSeatBase: null,
    perSeatOverage: null,
    concurrentAgents: "Unlimited",
    graphStorage: "Unlimited",
    retention: "Unlimited",
    sandboxLaunchesPerMonth: "Unlimited",
    sso: true,
    auditLogs: true,
    complianceExports: true,
    dedicatedSlack: true,
    dedicatedTenant: "n/a",
    privateRegistry: true,
    deployment: "Customer's Kubernetes cluster",
    responseSla: "Dedicated, 2h response",
    additionalNotes: [
      "Air-gap capable",
      "Priority feature requests",
    ],
    isMostPopular: false,
    cta: {
      label: "Contact sales",
      href: "/contact-sales?tier=enterprise-onprem",
      variant: "secondary",
    },
  },
  {
    id: "public-sector",
    name: "Public Sector",
    tagline: "Deployed into government clouds or air-gapped on-prem, delivered via cleared partners",
    persona: "Government or defense buyer",
    monthlyPrice: null,
    annualPrice: null,
    contactOnly: true,
    annualSavingsPct: null,
    includedSeats: "Unlimited",
    perSeatBase: null,
    perSeatOverage: null,
    concurrentAgents: "Unlimited",
    graphStorage: "Unlimited",
    retention: "Unlimited",
    sandboxLaunchesPerMonth: "Unlimited",
    sso: true,
    auditLogs: true,
    complianceExports: true,
    dedicatedSlack: true,
    dedicatedTenant: "n/a",
    privateRegistry: true,
    deployment: "Your Kubernetes (on-prem, air-gapped, or gov cloud)",
    responseSla: "Dedicated, 2h response",
    additionalNotes: [
      "Cleared founder available for classified requirements discussions",
      "Delivered via cleared partner integrators and primes",
      "Air-gap capable",
    ],
    isMostPopular: false,
    cta: {
      label: "Contact sales",
      href: "/contact-sales?tier=public-sector",
      variant: "secondary",
    },
  },
];

export const selfServeTierIds: PricingTierId[] = [
  "solo",
  "squad",
  "org",
  "platform",
];

export const contactTierIds: PricingTierId[] = [
  "enterprise-cloud",
  "enterprise-onprem",
  "public-sector",
];
