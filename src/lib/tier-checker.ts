/**
 * Tier Checker Utilities
 *
 * Functions for checking tier-based restrictions and limits.
 * Supports all subscription tiers: indie, team, business, enterprise.
 */

import type { TierLevel, TierConfig } from '@/src/hooks/useTierLimits';

/**
 * Tier configurations.
 */
export const TIER_CONFIGS: Record<TierLevel, TierConfig> = {
  indie: {
    tier: 'indie',
    displayName: 'Indie',
    maxTeamMembers: 1,
    maxAPIKeys: Infinity,
    customRolesEnabled: false,
    auditLogRetentionDays: 30,
    ssoEnabled: false,
    prioritySupport: false,
  },
  team: {
    tier: 'team',
    displayName: 'Team',
    maxTeamMembers: 5,
    maxAPIKeys: Infinity,
    customRolesEnabled: false,
    auditLogRetentionDays: 30,
    ssoEnabled: false,
    prioritySupport: false,
  },
  business: {
    tier: 'business',
    displayName: 'Business',
    maxTeamMembers: 20,
    maxAPIKeys: Infinity,
    customRolesEnabled: true,
    auditLogRetentionDays: 90,
    ssoEnabled: true,
    prioritySupport: true,
  },
  enterprise: {
    tier: 'enterprise',
    displayName: 'Enterprise',
    maxTeamMembers: Infinity,
    maxAPIKeys: Infinity,
    customRolesEnabled: true,
    auditLogRetentionDays: 365,
    ssoEnabled: true,
    prioritySupport: true,
  },
};

/**
 * Tier order for comparison.
 */
const TIER_ORDER: TierLevel[] = ['indie', 'team', 'business', 'enterprise'];

/**
 * Limit check result.
 */
export interface LimitCheckResult {
  allowed: boolean;
  limit: number;
  current: number;
  remaining: number;
  message?: string;
}

/**
 * Feature check result.
 */
export interface FeatureCheckResult {
  available: boolean;
  requiredTier: TierLevel;
  message?: string;
}

/**
 * Get tier configuration by level.
 */
export function getTierConfig(tier: TierLevel): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Compare tier levels.
 * Returns: negative if a < b, 0 if a === b, positive if a > b
 */
export function compareTiers(a: TierLevel, b: TierLevel): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

/**
 * Check if tier A is higher than tier B.
 */
export function isHigherTier(a: TierLevel, b: TierLevel): boolean {
  return compareTiers(a, b) > 0;
}

/**
 * Check if tier A is at least tier B.
 */
export function isAtLeastTier(a: TierLevel, b: TierLevel): boolean {
  return compareTiers(a, b) >= 0;
}

/**
 * Get the next tier upgrade option.
 */
export function getNextTier(current: TierLevel): TierLevel | null {
  const currentIndex = TIER_ORDER.indexOf(current);
  if (currentIndex === -1 || currentIndex === TIER_ORDER.length - 1) {
    return null;
  }
  return TIER_ORDER[currentIndex + 1];
}

/**
 * Check team member limit.
 */
export function checkTeamMemberLimit(
  tier: TierLevel,
  currentCount: number,
  pendingInvitations: number = 0
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const effectiveCount = currentCount + pendingInvitations;
  const remaining = Math.max(0, config.maxTeamMembers - effectiveCount);

  if (effectiveCount >= config.maxTeamMembers) {
    return {
      allowed: false,
      limit: config.maxTeamMembers,
      current: effectiveCount,
      remaining: 0,
      message: config.maxTeamMembers === Infinity
        ? undefined
        : `You've reached the maximum of ${config.maxTeamMembers} team members on the ${config.displayName} plan.`,
    };
  }

  return {
    allowed: true,
    limit: config.maxTeamMembers,
    current: effectiveCount,
    remaining,
  };
}

/**
 * Check API key limit.
 */
export function checkAPIKeyLimit(
  tier: TierLevel,
  currentCount: number
): LimitCheckResult {
  const config = TIER_CONFIGS[tier];
  const remaining = Math.max(0, config.maxAPIKeys - currentCount);

  if (currentCount >= config.maxAPIKeys) {
    return {
      allowed: false,
      limit: config.maxAPIKeys,
      current: currentCount,
      remaining: 0,
      message: config.maxAPIKeys === Infinity
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

/**
 * Check custom roles feature.
 */
export function checkCustomRolesFeature(tier: TierLevel): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];

  if (!config.customRolesEnabled) {
    return {
      available: false,
      requiredTier: 'business',
      message: 'Custom roles are available on Business and Enterprise plans.',
    };
  }

  return { available: true, requiredTier: tier };
}

/**
 * Check SSO feature.
 */
export function checkSSOFeature(tier: TierLevel): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];

  if (!config.ssoEnabled) {
    return {
      available: false,
      requiredTier: 'business',
      message: 'SSO/OIDC integration is available on Business and Enterprise plans.',
    };
  }

  return { available: true, requiredTier: tier };
}

/**
 * Check priority support feature.
 */
export function checkPrioritySupportFeature(tier: TierLevel): FeatureCheckResult {
  const config = TIER_CONFIGS[tier];

  if (!config.prioritySupport) {
    return {
      available: false,
      requiredTier: 'business',
      message: 'Priority support is available on Business and Enterprise plans.',
    };
  }

  return { available: true, requiredTier: tier };
}

/**
 * Get audit log retention days.
 */
export function getAuditLogRetention(tier: TierLevel): number {
  return TIER_CONFIGS[tier].auditLogRetentionDays;
}

/**
 * Check if a feature is available at a specific tier.
 */
export function isFeatureAvailable(
  currentTier: TierLevel,
  requiredTier: TierLevel
): boolean {
  return isAtLeastTier(currentTier, requiredTier);
}

/**
 * Get upgrade recommendation based on usage.
 */
export function getUpgradeRecommendation(
  tier: TierLevel,
  usage: {
    teamMemberCount: number;
    pendingInvitationCount: number;
    apiKeyCount: number;
  }
): {
  shouldUpgrade: boolean;
  reason: string[];
  recommendedTier: TierLevel | null;
} {
  const config = TIER_CONFIGS[tier];
  const reasons: string[] = [];

  // Check team member usage
  const effectiveTeamCount = usage.teamMemberCount + usage.pendingInvitationCount;
  if (config.maxTeamMembers !== Infinity) {
    const teamUsagePercent = effectiveTeamCount / config.maxTeamMembers;
    if (teamUsagePercent >= 0.8) {
      reasons.push('Team member limit approaching');
    }
  }

  // Check API key usage
  if (config.maxAPIKeys !== Infinity) {
    const apiKeyUsagePercent = usage.apiKeyCount / config.maxAPIKeys;
    if (apiKeyUsagePercent >= 0.8) {
      reasons.push('API key limit approaching');
    }
  }

  // Check feature limitations
  if (!config.customRolesEnabled) {
    reasons.push('Custom roles unavailable');
  }

  if (!config.ssoEnabled) {
    reasons.push('SSO unavailable');
  }

  const shouldUpgrade = reasons.length > 0;
  const recommendedTier = shouldUpgrade ? getNextTier(tier) : null;

  return {
    shouldUpgrade,
    reason: reasons,
    recommendedTier,
  };
}

/**
 * Format limit message for display.
 */
export function formatLimitMessage(
  limitType: 'team_members' | 'api_keys',
  current: number,
  limit: number
): string {
  if (limit === Infinity) {
    return `${current} ${limitType === 'team_members' ? 'team members' : 'API keys'} (unlimited)`;
  }

  const remaining = Math.max(0, limit - current);
  const limitName = limitType === 'team_members' ? 'team members' : 'API keys';

  if (remaining === 0) {
    return `${current}/${limit} ${limitName} (limit reached)`;
  }

  return `${current}/${limit} ${limitName} (${remaining} remaining)`;
}

/**
 * Get tier benefits comparison.
 */
export function getTierComparison(
  fromTier: TierLevel,
  toTier: TierLevel
): { feature: string; before: string; after: string }[] {
  const from = TIER_CONFIGS[fromTier];
  const to = TIER_CONFIGS[toTier];

  const comparison: { feature: string; before: string; after: string }[] = [];

  if (to.maxTeamMembers > from.maxTeamMembers) {
    comparison.push({
      feature: 'Team Members',
      before: from.maxTeamMembers === Infinity ? 'Unlimited' : String(from.maxTeamMembers),
      after: to.maxTeamMembers === Infinity ? 'Unlimited' : String(to.maxTeamMembers),
    });
  }

  if (to.maxAPIKeys > from.maxAPIKeys) {
    comparison.push({
      feature: 'API Keys',
      before: from.maxAPIKeys === Infinity ? 'Unlimited' : String(from.maxAPIKeys),
      after: to.maxAPIKeys === Infinity ? 'Unlimited' : String(to.maxAPIKeys),
    });
  }

  if (to.customRolesEnabled && !from.customRolesEnabled) {
    comparison.push({
      feature: 'Custom Roles',
      before: 'Not available',
      after: 'Available',
    });
  }

  if (to.ssoEnabled && !from.ssoEnabled) {
    comparison.push({
      feature: 'SSO/OIDC',
      before: 'Not available',
      after: 'Available',
    });
  }

  if (to.auditLogRetentionDays > from.auditLogRetentionDays) {
    comparison.push({
      feature: 'Audit Log Retention',
      before: `${from.auditLogRetentionDays} days`,
      after: `${to.auditLogRetentionDays} days`,
    });
  }

  if (to.prioritySupport && !from.prioritySupport) {
    comparison.push({
      feature: 'Priority Support',
      before: 'Not available',
      after: 'Available',
    });
  }

  return comparison;
}
