'use client';

/**
 * useTierQuota Hook
 *
 * Fetches the current tenant's tier configuration and usage from
 * /api/settings/tier. Provides typed access to quota limits and
 * current consumption.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/fetch';

export interface TierConfig {
  tier: string;
  displayName: string;
  maxTeamMembers: number;
  maxAPIKeys: number;
  customRolesEnabled: boolean;
  auditLogRetentionDays: number;
  ssoEnabled: boolean;
  prioritySupport: boolean;
}

export interface TierUsage {
  teamMemberCount: number;
  apiKeyCount: number;
  customRoleCount: number;
  pendingInvitationCount: number;
}

export interface TierQuota {
  config: TierConfig;
  usage: TierUsage;
}

async function fetchTierQuota(): Promise<TierQuota> {
  const response = await apiFetch('/api/settings/tier');
  if (!response.ok) {
    throw new Error(`Failed to fetch tier quota: ${response.status}`);
  }
  return response.json();
}

export function useTierQuota() {
  return useQuery<TierQuota>({
    queryKey: ['tier-quota'],
    queryFn: fetchTierQuota,
    staleTime: 60_000,
  });
}
