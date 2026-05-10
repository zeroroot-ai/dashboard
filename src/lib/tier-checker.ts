/**
 * tier-checker.ts — Minimal plan-id helpers over the canonical plan
 * registry (@/src/generated/plans).
 *
 * Spec plans-and-quotas-simplification reduces the registry to three
 * plans (team / enterprise / enterprise-deploy) with two enforced
 * quotas. The previous TierConfig abstraction (seats / retention /
 * has_sso / has_dedicated_slack etc.) is gone; this file now offers
 * only the lightweight ordering helpers existing callers still use.
 */

import type { Plan, PlanID } from "@/src/generated/plans";
import { plans, planIDs, lookupPlan } from "@/src/generated/plans";

/** TierLevel is the canonical PlanID. */
export type TierLevel = PlanID;

/** Display info for a plan tier. */
export interface TierConfig {
  tier: TierLevel;
  displayName: string;
  /** Concurrent missions limit; 0 = unlimited. */
  concurrentMissions: number;
  /** Concurrent agents limit; 0 = unlimited. */
  concurrentAgents: number;
}

export interface LimitCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string;
}

function planToTierConfig(plan: Plan): TierConfig {
  return {
    tier: plan.id,
    displayName: plan.displayName,
    concurrentMissions: plan.quotas.concurrent_missions,
    concurrentAgents: plan.quotas.concurrent_agents,
  };
}

/** Tier configuration map keyed by PlanID. */
export const TIER_CONFIGS: Record<TierLevel, TierConfig> = Object.freeze(
  Object.fromEntries(plans.map((p) => [p.id, planToTierConfig(p)])) as Record<
    TierLevel,
    TierConfig
  >,
);

/** Tier ordering (pricing-page registry order). */
const TIER_ORDER: readonly TierLevel[] = planIDs;

export function getTierConfig(tier: TierLevel): TierConfig {
  return TIER_CONFIGS[tier];
}

export function compareTiers(a: TierLevel, b: TierLevel): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

export function isHigherTier(a: TierLevel, b: TierLevel): boolean {
  return compareTiers(a, b) > 0;
}

export function isAtLeastTier(a: TierLevel, b: TierLevel): boolean {
  return compareTiers(a, b) >= 0;
}

export function getNextTier(current: TierLevel): TierLevel | null {
  const idx = TIER_ORDER.indexOf(current);
  if (idx === -1 || idx === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

/**
 * checkConcurrentMissionLimit returns whether a mission submission would
 * fit within the tier's concurrent_missions cap.
 */
export function checkConcurrentMissionLimit(
  tier: TierLevel,
  currentInFlight: number,
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const limit = config.concurrentMissions;
  if (limit === 0) {
    return { allowed: true, limit: Infinity, current: currentInFlight, remaining: Infinity };
  }
  const remaining = Math.max(0, limit - currentInFlight);
  if (currentInFlight >= limit) {
    return {
      allowed: false,
      limit,
      current: currentInFlight,
      remaining: 0,
      message: `You've hit the ${config.displayName} plan's concurrent_missions cap (${limit}). Wait for one to finish, or upgrade.`,
    };
  }
  return { allowed: true, limit, current: currentInFlight, remaining };
}

/**
 * checkConcurrentAgentLimit returns whether a new agent task dispatch
 * would fit within the tier's concurrent_agents cap.
 */
export function checkConcurrentAgentLimit(
  tier: TierLevel,
  currentBusy: number,
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const limit = config.concurrentAgents;
  if (limit === 0) {
    return { allowed: true, limit: Infinity, current: currentBusy, remaining: Infinity };
  }
  const remaining = Math.max(0, limit - currentBusy);
  if (currentBusy >= limit) {
    return {
      allowed: false,
      limit,
      current: currentBusy,
      remaining: 0,
      message: `You've hit the ${config.displayName} plan's concurrent_agents cap (${limit}). Wait for tasks to complete, or upgrade.`,
    };
  }
  return { allowed: true, limit, current: currentBusy, remaining };
}

export function formatQuotaMessage(
  metric: "missions" | "agents",
  current: number,
  limit: number,
): string {
  const noun = metric === "missions" ? "concurrent missions" : "concurrent agents";
  if (limit === 0) return `${current} ${noun} (unlimited)`;
  const remaining = Math.max(0, limit - current);
  if (remaining === 0) return `${current}/${limit} ${noun} (at limit)`;
  return `${current}/${limit} ${noun} (${remaining} remaining)`;
}

/** Re-export lookupPlan so callers have a single entry point. */
export { lookupPlan };
