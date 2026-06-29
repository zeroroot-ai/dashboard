/**
 * useTierLimits Hook
 *
 * React-Query hook for fetching the tenant's current tier configuration
 * and live usage. Spec plans-and-quotas-simplification reduces this to
 * the two enforced quotas; legacy team-member / API-key / SSO surfaces
 * are dropped.
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


/** Live usage snapshot (mirrors the daemon's :active counters). */
interface TierUsage {
  /** Missions currently in non-terminal execution at any moment. */
  concurrentMissions: number;
  /** Agents currently bound to in-flight tasks. */
  concurrentAgents: number;
}

/** Tier limits + usage response. */
interface TierLimitsResponse {
  config: TierConfig;
  usage: TierUsage;
}

const tierLimitsKeys = {
  all: ["tier-limits"] as const,
  current: () => [...tierLimitsKeys.all, "current"] as const,
};

/** Default fallback used when the tier API is unavailable. Selects
 * the smallest plan in the registry so the dashboard renders something
 * conservative. */
const DEFAULT_TIER: TierLevel = "team";
const DEFAULT_TIER_RESPONSE: TierLimitsResponse = {
  config: TIER_CONFIGS[DEFAULT_TIER],
  usage: { concurrentMissions: 0, concurrentAgents: 0 },
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

function useTierLimitCheck() {
  const { data } = useTierLimits();

  return useMemo(() => {
    if (!data) {
      const fallback = TIER_CONFIGS[DEFAULT_TIER];
      return {
        canRunMission: false,
        canDispatchAgent: false,
        missionsRemaining: 0,
        agentsRemaining: 0,
        isAtMissionLimit: true,
        isAtAgentLimit: true,
        tier: DEFAULT_TIER,
        config: fallback,
        usage: null,
      };
    }
    const { config, usage } = data;
    const missionLimit = config.concurrentMissions;
    const agentLimit = config.concurrentAgents;
    const missionsUnlimited = missionLimit === 0;
    const agentsUnlimited = agentLimit === 0;
    return {
      canRunMission: missionsUnlimited || usage.concurrentMissions < missionLimit,
      canDispatchAgent: agentsUnlimited || usage.concurrentAgents < agentLimit,
      missionsRemaining: missionsUnlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, missionLimit - usage.concurrentMissions),
      agentsRemaining: agentsUnlimited
        ? Number.POSITIVE_INFINITY
        : Math.max(0, agentLimit - usage.concurrentAgents),
      isAtMissionLimit: !missionsUnlimited && usage.concurrentMissions >= missionLimit,
      isAtAgentLimit: !agentsUnlimited && usage.concurrentAgents >= agentLimit,
      tier: config.tier,
      config,
      usage,
    };
  }, [data]);
}

function useUpgradeRecommendation() {
  const { data } = useTierLimits();

  return useMemo(() => {
    if (!data) return null;
    const { config, usage } = data;
    const limitations: string[] = [];

    if (
      config.concurrentMissions !== 0 &&
      usage.concurrentMissions >= config.concurrentMissions * 0.8
    ) {
      limitations.push("concurrent_missions");
    }
    if (
      config.concurrentAgents !== 0 &&
      usage.concurrentAgents >= config.concurrentAgents * 0.8
    ) {
      limitations.push("concurrent_agents");
    }
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
