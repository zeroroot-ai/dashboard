'use client';

/**
 * Provider Query Hooks
 * React Query hooks for LLM provider data fetching
 */

import {
  useQuery,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  listProviders,
  getProvider,
  getHealthStatus,
  getAuditLog,
  getFallbackChain,
} from '@/src/lib/api/providers';
import type {
  ProviderConfig,
  ListProvidersResponse,
  GetHealthStatusResponse,
  ProviderAuditEvent,
  ProviderAuditEventType,
  HealthStatus,
} from '@/src/types/provider';

// ============================================================================
// Query Keys
// ============================================================================

export const providerQueryKeys = {
  all: ['providers'] as const,
  lists: () => [...providerQueryKeys.all, 'list'] as const,
  list: (options?: { includeDisabled?: boolean; includeHealth?: boolean }) =>
    [...providerQueryKeys.lists(), options] as const,
  details: () => [...providerQueryKeys.all, 'detail'] as const,
  detail: (name: string) => [...providerQueryKeys.details(), name] as const,
  health: () => [...providerQueryKeys.all, 'health'] as const,
  healthForProvider: (name: string) => [...providerQueryKeys.health(), name] as const,
  healthAll: () => [...providerQueryKeys.health(), 'all'] as const,
  fallback: () => [...providerQueryKeys.all, 'fallback'] as const,
  audit: () => [...providerQueryKeys.all, 'audit'] as const,
  auditFiltered: (filters?: AuditFilters) => [...providerQueryKeys.audit(), filters] as const,
};

// ============================================================================
// Types
// ============================================================================

interface AuditFilters {
  providerName?: string;
  eventTypes?: ProviderAuditEventType[];
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Provider List Hook
// ============================================================================

/**
 * Hook for fetching the list of LLM providers
 *
 * @param options - Query options
 * @param options.includeDisabled - Include disabled providers (default: false)
 * @param options.includeHealth - Include health status (default: true)
 * @returns Query result with provider list, default provider, and fallback chain
 */
export function useProviders(options?: {
  includeDisabled?: boolean;
  includeHealth?: boolean;
}): UseQueryResult<ListProvidersResponse, Error> {
  return useQuery({
    queryKey: providerQueryKeys.list(options),
    queryFn: () => listProviders(options),
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching only enabled providers
 *
 * @returns Query result with enabled provider list
 */
export function useEnabledProviders(): UseQueryResult<ProviderConfig[], Error> {
  const query = useProviders({ includeDisabled: false, includeHealth: true });

  return {
    ...query,
    data: query.data?.providers,
  } as unknown as UseQueryResult<ProviderConfig[], Error>;
}

/**
 * Hook for fetching the default provider
 *
 * @returns Query result with default provider or undefined
 */
export function useDefaultProvider(): UseQueryResult<ProviderConfig | undefined, Error> {
  const query = useProviders({ includeDisabled: false, includeHealth: true });

  return {
    ...query,
    data: query.data?.providers.find((p) => p.isDefault),
  } as unknown as UseQueryResult<ProviderConfig | undefined, Error>;
}

// ============================================================================
// Single Provider Hook
// ============================================================================

/**
 * Hook for fetching a single provider by name
 *
 * @param name - The provider name to fetch
 * @param options - Query options
 * @returns Query result with provider data
 */
export function useProvider(
  name: string,
  options?: { includeHealth?: boolean }
): UseQueryResult<ProviderConfig, Error> {
  return useQuery({
    queryKey: providerQueryKeys.detail(name),
    queryFn: () => getProvider(name, options),
    staleTime: 30000,
    gcTime: 300000,
    enabled: !!name,
  });
}

// ============================================================================
// Health Status Hooks
// ============================================================================

/**
 * Hook for fetching health status for all providers
 *
 * @param options - Query options
 * @param options.refresh - Force fresh health check
 * @returns Query result with health statuses
 */
export function useProvidersHealth(options?: {
  providerNames?: string[];
  refresh?: boolean;
}): UseQueryResult<GetHealthStatusResponse, Error> {
  return useQuery({
    queryKey: providerQueryKeys.healthAll(),
    queryFn: () => getHealthStatus(options),
    staleTime: 60000, // 1 minute
    gcTime: 300000,
    refetchInterval: 60000, // Auto-refresh every minute
  });
}

/**
 * Hook for fetching health status for a specific provider
 *
 * @param name - The provider name
 * @returns Query result with health status
 */
export function useProviderHealth(name: string): UseQueryResult<HealthStatus | undefined, Error> {
  const query = useProvidersHealth();

  return {
    ...query,
    data: query.data?.statuses[name],
  } as unknown as UseQueryResult<HealthStatus | undefined, Error>;
}

// ============================================================================
// Fallback Chain Hook
// ============================================================================

/**
 * Hook for fetching the fallback chain
 *
 * @returns Query result with fallback chain
 */
export function useFallbackChain(): UseQueryResult<string[], Error> {
  return useQuery({
    queryKey: providerQueryKeys.fallback(),
    queryFn: getFallbackChain,
    staleTime: 30000,
    gcTime: 300000,
  });
}

/**
 * Hook for fetching fallback chain with provider details
 *
 * @returns Query result with fallback providers
 */
export function useFallbackChainWithDetails(): UseQueryResult<ProviderConfig[], Error> {
  const providersQuery = useProviders({ includeDisabled: false, includeHealth: true });

  // Get providers in fallback order
  const fallbackProviders = providersQuery.data?.fallbackChain
    ?.map((name) => providersQuery.data?.providers.find((p) => p.name === name))
    .filter((p): p is ProviderConfig => p !== undefined);

  return {
    ...providersQuery,
    data: fallbackProviders,
  } as unknown as UseQueryResult<ProviderConfig[], Error>;
}

// ============================================================================
// Audit Log Hook
// ============================================================================

/**
 * Hook for fetching provider audit log
 *
 * @param filters - Audit log filters
 * @returns Query result with audit events
 */
export function useProviderAuditLog(
  filters?: AuditFilters
): UseQueryResult<{ events: ProviderAuditEvent[]; total: number }, Error> {
  return useQuery({
    queryKey: providerQueryKeys.auditFiltered(filters),
    queryFn: () => getAuditLog(filters),
    staleTime: 30000,
    gcTime: 300000,
  });
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook for getting provider by type
 *
 * @param type - The provider type to filter by
 * @returns Query result with providers of the specified type
 */
export function useProvidersByType(type: string): UseQueryResult<ProviderConfig[], Error> {
  const query = useProviders({ includeDisabled: true, includeHealth: true });

  return {
    ...query,
    data: query.data?.providers.filter((p) => p.type === type),
  } as unknown as UseQueryResult<ProviderConfig[], Error>;
}

/**
 * Hook for checking if any provider is unhealthy
 *
 * @returns Query result with unhealthy status
 */
export function useAnyProviderUnhealthy(): UseQueryResult<boolean, Error> {
  const query = useProvidersHealth();

  const hasUnhealthy = query.data?.statuses
    ? Object.values(query.data.statuses).some((s) => s.status === 'unhealthy')
    : false;

  return {
    ...query,
    data: hasUnhealthy,
  } as unknown as UseQueryResult<boolean, Error>;
}

/**
 * Hook for getting provider count by health status
 *
 * @returns Query result with health status counts
 */
export function useProviderHealthCounts(): UseQueryResult<{
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
}, Error> {
  const query = useProvidersHealth();

  const counts = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unknown: 0,
  };

  if (query.data?.statuses) {
    Object.values(query.data.statuses).forEach((status) => {
      counts[status.status]++;
    });
  }

  return {
    ...query,
    data: counts,
  } as unknown as UseQueryResult<typeof counts, Error>;
}
