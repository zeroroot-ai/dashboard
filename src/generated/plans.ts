// GENERATED FILE, do not edit.
// Source: enterprise/deploy/helm/gibson-operators/files/plans.yaml
// Generator: enterprise/platform/dashboard/scripts/gen-plans.mjs
// Run `npm run build` (or the `prebuild` hook) to regenerate.

export type PlanID =
  | "team"
  | "org"
  | "enterprise"
  | "enterprise-deploy";

export interface Quotas {
  /** Max concurrent (in-flight) missions; 0 = unlimited. */
  concurrent_missions: number;
  /** Max concurrent agents bound to in-flight tasks; 0 = unlimited.
   *  Idle-but-connected agents do NOT count toward this quota. */
  concurrent_agents: number;
}

export interface Pricing {
  monthlyUSD?: number;
  annualUSD?: number;
  annualSavingsPct?: number;
  contactSales?: boolean;
}

export interface Plan {
  id: PlanID;
  displayName: string;
  tagline: string;
  stripeProductId: string | null;
  /** Card-first-signup trial length (days). 0/absent on contactSales tiers. */
  trialDays?: number;
  pricing: Pricing;
  quotas: Quotas;
}

export const PLAN_REGISTRY_VERSION = "v1";

export const plans: readonly Plan[] = Object.freeze([
  {
    "id": "team",
    "displayName": "Team",
    "tagline": "For small red teams getting started with continuous AI red teaming",
    "stripeProductId": "prod_UUghrBirQfk8sn",
    "trialDays": 14,
    "pricing": {
      "monthlyUSD": 799
    },
    "quotas": {
      "concurrent_missions": 10,
      "concurrent_agents": 100
    }
  },
  {
    "id": "org",
    "displayName": "Org",
    "tagline": "For security organisations running coverage across multiple AI surfaces",
    "stripeProductId": "prod_UUghpmfCDlbOyn",
    "trialDays": 14,
    "pricing": {
      "monthlyUSD": 4999
    },
    "quotas": {
      "concurrent_missions": 50,
      "concurrent_agents": 250
    }
  },
  {
    "id": "enterprise",
    "displayName": "Enterprise",
    "tagline": "For platform teams operating Gibson at scale across business units",
    "stripeProductId": "prod_UUghAQW2znkSrb",
    "trialDays": 14,
    "pricing": {
      "monthlyUSD": 9999
    },
    "quotas": {
      "concurrent_missions": 75,
      "concurrent_agents": 0
    }
  },
  {
    "id": "enterprise-deploy",
    "displayName": "Enterprise (On-Prem & Federal)",
    "tagline": "Self-hosted in your VPC, on-prem datacentre, or air-gapped enclave",
    "stripeProductId": null,
    "pricing": {
      "contactSales": true
    },
    "quotas": {
      "concurrent_missions": 0,
      "concurrent_agents": 0
    }
  },
]);

export const planIDs: readonly PlanID[] = Object.freeze(["team", "org", "enterprise", "enterprise-deploy"]) as readonly PlanID[];

const byID: Readonly<Record<PlanID, Plan>> = Object.freeze(
  Object.fromEntries(plans.map((p) => [p.id, p])) as Record<PlanID, Plan>,
);

export function lookupPlan(id: PlanID): Plan {
  const p = byID[id];
  if (!p) throw new Error(`unknown plan id: ${id}`);
  return p;
}
