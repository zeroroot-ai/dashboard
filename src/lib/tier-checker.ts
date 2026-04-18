/**
 * tier-checker.ts — Derived tier-config helpers over the canonical plan
 * registry (@/src/generated/plans).
 *
 * Historically this file held its own TIER_CONFIGS record duplicating the
 * data in plans.ts. After the plan-registry migration, TIER_CONFIGS is
 * derived at module-load time from the generated Plan[] and exposes the
 * legacy TierConfig shape so existing callers (useTierLimits, API route,
 * BillingContent) continue to compile unchanged. All new code should
 * prefer importing plans / lookupPlan from @/src/generated/plans directly.
 *
 * The PlanID from the generated module IS the TierLevel here — there is no
 * separate legacy enum.
 */

import type { Plan, PlanID } from "@/src/generated/plans";
import { plans, planIDs, lookupPlan } from "@/src/generated/plans";

/** TierLevel is the canonical PlanID (seven values). */
export type TierLevel = PlanID;

/**
 * Legacy tier configuration shape preserved for existing callers. New code
 * should read directly from the Plan type; these fields are derived:
 *   - maxTeamMembers          ← quotas.seats (-1 → Infinity)
 *   - maxAPIKeys              ← Infinity (no new field; historical behavior)
 *   - customRolesEnabled      ← features.has_audit_logs (proxy: first tier
 *                                with enterprise-grade features)
 *   - auditLogRetentionDays   ← quotas.retention_days (-1 → Infinity)
 *   - ssoEnabled              ← features.has_sso
 *   - prioritySupport         ← features.has_dedicated_slack
 */
export interface TierConfig {
  tier: TierLevel;
  displayName: string;
  maxTeamMembers: number;
  maxAPIKeys: number;
  customRolesEnabled: boolean;
  auditLogRetentionDays: number;
  ssoEnabled: boolean;
  prioritySupport: boolean;
}

export interface LimitCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string;
}

export interface FeatureCheckResult {
  available: boolean;
  requiredTier: TierLevel;
  message?: string;
}

function planToTierConfig(plan: Plan): TierConfig {
  const seats = plan.quotas.seats === -1 ? Infinity : plan.quotas.seats;
  const retention =
    plan.quotas.retention_days === -1 ? Infinity : plan.quotas.retention_days;
  return {
    tier: plan.id,
    displayName: plan.displayName,
    maxTeamMembers: seats,
    maxAPIKeys: Infinity,
    customRolesEnabled: plan.features.has_audit_logs,
    auditLogRetentionDays: retention,
    ssoEnabled: plan.features.has_sso,
    prioritySupport: plan.features.has_dedicated_slack,
  };
}

/** Derived tier config map keyed by PlanID. */
export const TIER_CONFIGS: Record<TierLevel, TierConfig> = Object.freeze(
  Object.fromEntries(plans.map((p) => [p.id, planToTierConfig(p)])) as Record<
    TierLevel,
    TierConfig
  >,
);

/** Tier ordering for comparison. Uses pricing-page order from the registry. */
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

export function checkTeamMemberLimit(
  tier: TierLevel,
  currentCount: number,
  pendingInvitations: number = 0,
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const effective = currentCount + pendingInvitations;
  const remaining = Math.max(0, config.maxTeamMembers - effective);

  if (effective >= config.maxTeamMembers) {
    return {
      allowed: false,
      limit: config.maxTeamMembers,
      current: effective,
      remaining: 0,
      message:
        config.maxTeamMembers === Infinity
          ? undefined
          : `You've reached the maximum of ${config.maxTeamMembers} team members on the ${config.displayName} plan.`,
    };
  }

  return {
    allowed: true,
    limit: config.maxTeamMembers,
    current: effective,
    remaining,
  };
}

export function checkAPIKeyLimit(
  tier: TierLevel,
  currentCount: number,
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const remaining = Math.max(0, config.maxAPIKeys - currentCount);

  if (currentCount >= config.maxAPIKeys) {
    return {
      allowed: false,
      limit: config.maxAPIKeys,
      current: currentCount,
      remaining: 0,
      message:
        config.maxAPIKeys === Infinity
          ? undefined
          : `You've reached the maximum of ${config.maxAPIKeys} API keys on the ${config.displayName} plan.`,
    };
  }

  return {
    allowed: true,
    limit: config.maxAPIKeys,
    current: currentCount,
    remaining,
  };
}

export function checkCustomRolesFeature(tier: TierLevel): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];
  if (!config.customRolesEnabled) {
    return {
      available: false,
      requiredTier: "org",
      message: "Custom roles are available on Org and higher plans.",
    };
  }
  return { available: true, requiredTier: tier };
}

export function checkSSOFeature(tier: TierLevel): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];
  if (!config.ssoEnabled) {
    return {
      available: false,
      requiredTier: "org",
      message: "SSO/OIDC integration is available on Org and higher plans.",
    };
  }
  return { available: true, requiredTier: tier };
}

export function checkPrioritySupportFeature(
  tier: TierLevel,
): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];
  if (!config.prioritySupport) {
    return {
      available: false,
      requiredTier: "org",
      message: "Priority support is available on Org and higher plans.",
    };
  }
  return { available: true, requiredTier: tier };
}

export function getAuditLogRetention(tier: TierLevel): number {
  return TIER_CONFIGS[tier].auditLogRetentionDays;
}

export function isFeatureAvailable(
  currentTier: TierLevel,
  requiredTier: TierLevel,
): boolean {
  return isAtLeastTier(currentTier, requiredTier);
}

export function getUpgradeRecommendation(
  tier: TierLevel,
  usage: {
    teamMemberCount: number;
    pendingInvitationCount: number;
    apiKeyCount: number;
  },
): {
  shouldUpgrade: boolean;
  reason: string[];
  recommendedTier: TierLevel | null;
} {
  const config = TIER_CONFIGS[tier];
  const reasons: string[] = [];
  const effectiveTeam = usage.teamMemberCount + usage.pendingInvitationCount;

  if (config.maxTeamMembers !== Infinity) {
    const pct = effectiveTeam / config.maxTeamMembers;
    if (pct >= 0.8) reasons.push("Team member limit approaching");
  }
  if (config.maxAPIKeys !== Infinity) {
    const pct = usage.apiKeyCount / config.maxAPIKeys;
    if (pct >= 0.8) reasons.push("API key limit approaching");
  }
  if (!config.customRolesEnabled) reasons.push("Custom roles unavailable");
  if (!config.ssoEnabled) reasons.push("SSO unavailable");

  const shouldUpgrade = reasons.length > 0;
  return {
    shouldUpgrade,
    reason: reasons,
    recommendedTier: shouldUpgrade ? getNextTier(tier) : null,
  };
}

export function formatLimitMessage(
  limitType: "team_members" | "api_keys",
  current: number,
  limit: number,
): string {
  const limitName = limitType === "team_members" ? "team members" : "API keys";
  if (limit === Infinity) return `${current} ${limitName} (unlimited)`;
  const remaining = Math.max(0, limit - current);
  if (remaining === 0) return `${current}/${limit} ${limitName} (limit reached)`;
  return `${current}/${limit} ${limitName} (${remaining} remaining)`;
}

export function getTierComparison(
  fromTier: TierLevel,
  toTier: TierLevel,
): { feature: string; before: string; after: string }[] {
  const from = TIER_CONFIGS[fromTier];
  const to = TIER_CONFIGS[toTier];
  const comparison: { feature: string; before: string; after: string }[] = [];

  if (to.maxTeamMembers > from.maxTeamMembers) {
    comparison.push({
      feature: "Team Members",
      before:
        from.maxTeamMembers === Infinity ? "Unlimited" : String(from.maxTeamMembers),
      after: to.maxTeamMembers === Infinity ? "Unlimited" : String(to.maxTeamMembers),
    });
  }
  if (to.maxAPIKeys > from.maxAPIKeys) {
    comparison.push({
      feature: "API Keys",
      before: from.maxAPIKeys === Infinity ? "Unlimited" : String(from.maxAPIKeys),
      after: to.maxAPIKeys === Infinity ? "Unlimited" : String(to.maxAPIKeys),
    });
  }
  if (to.customRolesEnabled && !from.customRolesEnabled) {
    comparison.push({ feature: "Custom Roles", before: "Not available", after: "Available" });
  }
  if (to.ssoEnabled && !from.ssoEnabled) {
    comparison.push({ feature: "SSO/OIDC", before: "Not available", after: "Available" });
  }
  if (to.auditLogRetentionDays > from.auditLogRetentionDays) {
    comparison.push({
      feature: "Audit Log Retention",
      before:
        from.auditLogRetentionDays === Infinity
          ? "Unlimited"
          : `${from.auditLogRetentionDays} days`,
      after:
        to.auditLogRetentionDays === Infinity
          ? "Unlimited"
          : `${to.auditLogRetentionDays} days`,
    });
  }
  if (to.prioritySupport && !from.prioritySupport) {
    comparison.push({ feature: "Priority Support", before: "Not available", after: "Available" });
  }
  return comparison;
}

/** Re-export lookupPlan so callers that want the full Plan have a single entry point. */
export { lookupPlan };
