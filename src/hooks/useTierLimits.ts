/**
 * useTierLimits Hook
 *
 * Hook for checking subscription tier limits and usage.
 * Provides utilities for enforcing tier-based restrictions.
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

/**
 * Subscription tier levels.
 */
export type TierLevel = 'indie' | 'team' | 'business' | 'enterprise';

/**
 * Tier configuration and limits.
 */
export interface TierConfig {
  /** Tier level */
  tier: TierLevel;
  /** Display name */
  displayName: string;
  /** Maximum team members */
  maxTeamMembers: number;
  /** Maximum API keys per user */
  maxAPIKeys: number;
  /** Custom roles enabled */
  customRolesEnabled: boolean;
  /** Audit log retention in days */
  auditLogRetentionDays: number;
  /** SSO/OIDC enabled */
  ssoEnabled: boolean;
  /** Priority support enabled */
  prioritySupport: boolean;
}

/**
 * Current usage statistics.
 */
export interface TierUsage {
  /** Current team member count */
  teamMemberCount: number;
  /** Current API key count (for current user) */
  apiKeyCount: number;
  /** Custom roles created */
  customRoleCount: number;
  /** Pending invitations */
  pendingInvitationCount: number;
}

/**
 * Tier limits response.
 */
export interface TierLimitsResponse {
  /** Tier configuration */
  config: TierConfig;
  /** Current usage */
  usage: TierUsage;
}

/**
 * Tier configurations by level.
 */
const TIER_CONFIGS: Record<TierLevel, TierConfig> = {
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
 * Query keys for tier limits.
 */
export const tierLimitsKeys = {
  all: ['tier-limits'] as const,
  current: () => [...tierLimitsKeys.all, 'current'] as const,
};

/**
 * Default fallback response used when the tier API is unavailable.
 */
const DEFAULT_TIER_RESPONSE: TierLimitsResponse = {
  config: TIER_CONFIGS.team,
  usage: {
    teamMemberCount: 0,
    apiKeyCount: 0,
    customRoleCount: 0,
    pendingInvitationCount: 0,
  },
};

/**
 * Fetch tier limits from API, falling back to defaults on error.
 */
async function fetchTierLimits(): Promise<TierLimitsResponse> {
  try {
    const response = await fetch('/api/settings/tier');
    if (!response.ok) {
      return DEFAULT_TIER_RESPONSE;
    }
    const data = await response.json();
    // Validate minimal shape before trusting the response
    if (data?.config?.tier && data?.usage) {
      return data as TierLimitsResponse;
    }
    return DEFAULT_TIER_RESPONSE;
  } catch {
    return DEFAULT_TIER_RESPONSE;
  }
}

/**
 * Hook for fetching current tier limits and usage.
 */
export function useTierLimits(enabled = true) {
  return useQuery({
    queryKey: tierLimitsKeys.current(),
    queryFn: fetchTierLimits,
    enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for checking specific tier limits.
 */
export function useTierLimitCheck() {
  const { data } = useTierLimits();

  return useMemo(() => {
    if (!data) {
      return {
        canAddTeamMember: false,
        canCreateAPIKey: false,
        canCreateCustomRole: false,
        teamMembersRemaining: 0,
        apiKeysRemaining: 0,
        isAtTeamLimit: true,
        isAtAPIKeyLimit: true,
        tier: 'indie' as TierLevel,
        config: TIER_CONFIGS.indie,
        usage: null,
      };
    }

    const { config, usage } = data;
    const effectiveTeamCount = usage.teamMemberCount + usage.pendingInvitationCount;

    return {
      canAddTeamMember: effectiveTeamCount < config.maxTeamMembers,
      canCreateAPIKey: usage.apiKeyCount < config.maxAPIKeys,
      canCreateCustomRole: config.customRolesEnabled,
      teamMembersRemaining: Math.max(0, config.maxTeamMembers - effectiveTeamCount),
      apiKeysRemaining: Math.max(0, config.maxAPIKeys - usage.apiKeyCount),
      isAtTeamLimit: effectiveTeamCount >= config.maxTeamMembers,
      isAtAPIKeyLimit: usage.apiKeyCount >= config.maxAPIKeys,
      tier: config.tier,
      config,
      usage,
    };
  }, [data]);
}

/**
 * Hook for getting upgrade recommendations.
 */
export function useUpgradeRecommendation() {
  const { data } = useTierLimits();

  return useMemo(() => {
    if (!data) return null;

    const { config, usage } = data;
    const effectiveTeamCount = usage.teamMemberCount + usage.pendingInvitationCount;

    // Determine what features are limited
    const limitations: string[] = [];

    if (effectiveTeamCount >= config.maxTeamMembers * 0.8) {
      limitations.push('team_members');
    }

    if (usage.apiKeyCount >= config.maxAPIKeys * 0.8) {
      limitations.push('api_keys');
    }

    if (!config.customRolesEnabled) {
      limitations.push('custom_roles');
    }

    if (!config.ssoEnabled) {
      limitations.push('sso');
    }

    if (limitations.length === 0) return null;

    // Recommend next tier
    const tierOrder: TierLevel[] = ['indie', 'team', 'business', 'enterprise'];
    const currentIndex = tierOrder.indexOf(config.tier);
    const nextTier = tierOrder[currentIndex + 1];

    if (!nextTier) return null;

    return {
      currentTier: config.tier,
      recommendedTier: nextTier,
      recommendedConfig: TIER_CONFIGS[nextTier],
      limitations,
      urgency: limitations.length >= 2 ? 'high' : 'low',
    };
  }, [data]);
}

/**
 * Get tier configuration by level.
 */
export function getTierConfig(tier: TierLevel): TierConfig {
  return TIER_CONFIGS[tier];
}

/**
 * Compare tiers.
 */
export function compareTiers(a: TierLevel, b: TierLevel): number {
  const order: TierLevel[] = ['indie', 'team', 'business', 'enterprise'];
  return order.indexOf(a) - order.indexOf(b);
}

/**
 * Check if tier A is higher than tier B.
 */
export function isHigherTier(a: TierLevel, b: TierLevel): boolean {
  return compareTiers(a, b) > 0;
}

/**
 * Feature availability by tier.
 */
export const TIER_FEATURES = {
  customRoles: {
    availableFrom: 'business' as TierLevel,
    description: 'Create custom roles with specific permissions',
  },
  sso: {
    availableFrom: 'business' as TierLevel,
    description: 'Single sign-on with your identity provider',
  },
  auditExport: {
    availableFrom: 'team' as TierLevel,
    description: 'Export audit logs for compliance',
  },
  prioritySupport: {
    availableFrom: 'business' as TierLevel,
    description: 'Priority email and chat support',
  },
  unlimitedMembers: {
    availableFrom: 'enterprise' as TierLevel,
    description: 'Unlimited team members',
  },
};
