/**
 * useTierLimits Hook
 *
 * React-Query hook for fetching the tenant's current tier configuration and
 * usage. Types and TIER_CONFIGS are now derived from the canonical plan
 * registry; see @/src/lib/tier-checker for the adapter and
 * @/src/generated/plans for the source of truth.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  TIER_CONFIGS,
  type TierConfig,
  type TierLevel,
  compareTiers,
  getNextTier,
  getTierConfig,
  isHigherTier,
} from "@/src/lib/tier-checker";

export { TIER_CONFIGS, compareTiers, getNextTier, getTierConfig, isHigherTier };
export type { TierConfig, TierLevel };

/** Current usage statistics. */
export interface TierUsage {
  teamMemberCount: number;
  apiKeyCount: number;
  customRoleCount: number;
  pendingInvitationCount: number;
}

/** Tier limits response. */
export interface TierLimitsResponse {
  config: TierConfig;
  usage: TierUsage;
}

export const tierLimitsKeys = {
  all: ["tier-limits"] as const,
  current: () => [...tierLimitsKeys.all, "current"] as const,
};

/** Default fallback response used when the tier API is unavailable. */
const DEFAULT_TIER_RESPONSE: TierLimitsResponse = {
  config: TIER_CONFIGS.solo,
  usage: {
    teamMemberCount: 0,
    apiKeyCount: 0,
    customRoleCount: 0,
    pendingInvitationCount: 0,
  },
};

async function fetchTierLimits(): Promise<TierLimitsResponse> {
  try {
    const response = await fetch("/api/settings/tier");
    if (!response.ok) return DEFAULT_TIER_RESPONSE;
    const data = await response.json();
    if (data?.config?.tier && data?.usage) {
      return data as TierLimitsResponse;
    }
    return DEFAULT_TIER_RESPONSE;
  } catch {
    return DEFAULT_TIER_RESPONSE;
  }
}

export function useTierLimits(enabled = true) {
  return useQuery({
    queryKey: tierLimitsKeys.current(),
    queryFn: fetchTierLimits,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

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
        tier: "solo" as TierLevel,
        config: TIER_CONFIGS.solo,
        usage: null,
      };
    }
    const { config, usage } = data;
    const effectiveTeamCount =
      usage.teamMemberCount + usage.pendingInvitationCount;
    return {
      canAddTeamMember: effectiveTeamCount < config.maxTeamMembers,
      canCreateAPIKey: usage.apiKeyCount < config.maxAPIKeys,
      canCreateCustomRole: config.customRolesEnabled,
      teamMembersRemaining: Math.max(
        0,
        config.maxTeamMembers - effectiveTeamCount,
      ),
      apiKeysRemaining: Math.max(0, config.maxAPIKeys - usage.apiKeyCount),
      isAtTeamLimit: effectiveTeamCount >= config.maxTeamMembers,
      isAtAPIKeyLimit: usage.apiKeyCount >= config.maxAPIKeys,
      tier: config.tier,
      config,
      usage,
    };
  }, [data]);
}

export function useUpgradeRecommendation() {
  const { data } = useTierLimits();

  return useMemo(() => {
    if (!data) return null;
    const { config, usage } = data;
    const effectiveTeam = usage.teamMemberCount + usage.pendingInvitationCount;

    const limitations: string[] = [];
    if (
      config.maxTeamMembers !== Infinity &&
      effectiveTeam >= config.maxTeamMembers * 0.8
    ) {
      limitations.push("team_members");
    }
    if (
      config.maxAPIKeys !== Infinity &&
      usage.apiKeyCount >= config.maxAPIKeys * 0.8
    ) {
      limitations.push("api_keys");
    }
    if (!config.customRolesEnabled) limitations.push("custom_roles");
    if (!config.ssoEnabled) limitations.push("sso");

    if (limitations.length === 0) return null;

    const nextTier = getNextTier(config.tier);
    if (!nextTier) return null;

    return {
      currentTier: config.tier,
      recommendedTier: nextTier,
      recommendedConfig: TIER_CONFIGS[nextTier],
      limitations,
      urgency: limitations.length >= 2 ? "high" : "low",
    };
  }, [data]);
}

/** Feature availability metadata (unchanged from pre-migration). */
export const TIER_FEATURES = {
  customRoles: {
    availableFrom: "org" as TierLevel,
    description: "Create custom roles with specific permissions",
  },
  sso: {
    availableFrom: "org" as TierLevel,
    description: "Single sign-on with your identity provider",
  },
  auditExport: {
    availableFrom: "org" as TierLevel,
    description: "Export audit logs for compliance",
  },
  prioritySupport: {
    availableFrom: "org" as TierLevel,
    description: "Priority email and chat support",
  },
  unlimitedMembers: {
    availableFrom: "enterprise-cloud" as TierLevel,
    description: "Unlimited team members",
  },
};
