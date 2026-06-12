'use client';

/**
 * useProviderHealth, per-provider live health polling hook.
 *
 * Polls GET /api/settings/providers/[name]/health every 60 seconds
 * (background polling disabled when the tab is hidden).
 *
 * Distinct from useProvidersHealth / useProviderHealth in useProviders.ts,
 * which batch-fetches all providers via the getHealthStatus API. This hook
 * calls the individual per-provider health endpoint and is intended for
 * the ConfiguredProviderRow badge, one call per rendered card, each
 * independently refreshing.
 */

import { useQuery } from '@tanstack/react-query';
import type { ProviderHealthStatus } from '@/src/types/provider';

export interface ProviderHealthResponse {
  status: ProviderHealthStatus;
  lastCheckAt?: string;  // ISO / RFC 3339 timestamp
  lastError?: string;
}

/**
 * Fetches and auto-refreshes the health status for a single named provider.
 *
 * @param providerName - The provider name (matches the `name` field on ProviderConfig)
 * @returns React Query result with `{ status, lastCheckAt?, lastError? }`
 */
export function useProviderHealth(providerName: string) {
  return useQuery<ProviderHealthResponse>({
    queryKey: ['providers', providerName, 'health'],
    queryFn: async () => {
      const res = await fetch(
        `/api/settings/providers/${encodeURIComponent(providerName)}/health`,
      );
      if (!res.ok) throw new Error('health fetch failed');
      // Route returns: { health: { status, lastCheckAt?, lastError? } }
      const body = await res.json() as { health: ProviderHealthResponse };
      return body.health;
    },
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: { status: 'unknown' },
    // Don't retry on 401/404, those are deterministic failures
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof Error && error.message === 'health fetch failed'),
  });
}
