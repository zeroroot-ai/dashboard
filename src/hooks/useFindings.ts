'use client';

import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import type { Finding, FindingSeverity, PaginatedResponse } from '@/src/types';

interface FindingsFilters {
  severity?: FindingSeverity[];
  types?: string[];
  missionId?: string;
  search?: string;
  tenantId?: string;
}

interface FindingsPagination {
  limit?: number;
  cursor?: string;
}

interface FindingsCountsBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

/**
 * Fetch findings list with filters and pagination
 */
async function fetchFindings(
  filters: FindingsFilters = {},
  pagination: FindingsPagination = {}
): Promise<PaginatedResponse<Finding>> {
  const params = new URLSearchParams();

  // Tenant context is NOT passed via URL (dashboard#209). The
  // /api/findings route resolves the active tenant via requireActiveTenant()
  // (HMAC-signed cookie). The daemon trusts the X-Gibson-Identity-Tenant
  // header injected by ext-authz. Including the slug in the URL would
  // only leak it into browser history / referer / access logs.
  if (filters.severity && filters.severity.length > 0) {
    params.set('severity', filters.severity.join(','));
  }
  if (filters.types && filters.types.length > 0) {
    params.set('types', filters.types.join(','));
  }
  if (filters.missionId) {
    params.set('missionId', filters.missionId);
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (pagination.limit) {
    params.set('limit', pagination.limit.toString());
  }
  if (pagination.cursor) {
    params.set('cursor', pagination.cursor);
  }

  const response = await fetch(`/api/findings?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch findings: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch findings across multiple tenants (super-admin only)
 */
async function fetchCrossTenantFindings(
  filters: FindingsFilters = {},
  tenantIds?: string[],
  pagination: FindingsPagination = {}
): Promise<PaginatedResponse<Finding>> {
  const params = new URLSearchParams();

  if (tenantIds && tenantIds.length > 0) {
    params.set('tenantIds', tenantIds.join(','));
  }
  if (filters.severity && filters.severity.length > 0) {
    params.set('severity', filters.severity.join(','));
  }
  if (filters.types && filters.types.length > 0) {
    params.set('types', filters.types.join(','));
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (pagination.limit) {
    params.set('limit', pagination.limit.toString());
  }
  if (pagination.cursor) {
    params.set('cursor', pagination.cursor);
  }

  const response = await fetch(`/api/super-admin/findings?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch cross-tenant findings: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch single finding by ID
 */
async function fetchFinding(id: string): Promise<Finding> {
  const response = await fetch(`/api/findings/${id}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch finding: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch findings counts by severity
 */
async function fetchFindingsCounts(): Promise<FindingsCountsBySeverity> {
  const response = await fetch('/api/findings/counts');

  if (!response.ok) {
    throw new Error(`Failed to fetch findings counts: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Hook for fetching findings list with filters
 * Automatically scoped to the current tenant
 *
 * @param filters - Finding filter criteria
 * @param pagination - Pagination options
 * @returns Query result with findings data
 */
export function useFindings(
  filters: FindingsFilters = {},
  pagination: FindingsPagination = { limit: 50 }
) {
  // Get current tenant from store for automatic tenant filtering
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  // Merge tenant ID into filters
  const filtersWithTenant: FindingsFilters = {
    ...filters,
    tenantId: tenantId || filters.tenantId,
  };

  return useQuery({
    queryKey: queryKeys.findings.list(tenantId, filtersWithTenant),
    queryFn: () => fetchFindings(filtersWithTenant, pagination),
    staleTime: 30000, // 30 seconds
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching findings across multiple tenants (super-admin only)
 *
 * @param filters - Finding filter criteria
 * @param tenantIds - Optional list of tenant IDs to query
 * @param pagination - Pagination options
 * @returns Query result with cross-tenant findings data
 */
function useCrossTenantFindings(
  filters: FindingsFilters = {},
  tenantIds?: string[],
  pagination: FindingsPagination = { limit: 50 }
) {
  return useQuery({
    queryKey: ['cross-tenant-findings', filters, tenantIds],
    queryFn: () => fetchCrossTenantFindings(filters, tenantIds, pagination),
    staleTime: 30000,
    gcTime: 300000,
  });
}

/**
 * Hook for infinite scroll findings list
 *
 * @param filters - Finding filter criteria
 * @param limit - Items per page
 * @returns Infinite query result with findings data
 */
export function useInfiniteFindings(filters: FindingsFilters = {}, limit: number = 50) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  const filtersWithTenant: FindingsFilters = {
    ...filters,
    tenantId: tenantId || filters.tenantId,
  };

  return useInfiniteQuery({
    queryKey: [...queryKeys.findings.list(tenantId, filtersWithTenant), 'infinite'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      fetchFindings(filtersWithTenant, { limit, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30000,
    gcTime: 300000,
  });
}

/**
 * Hook for fetching single finding by ID
 *
 * @param id - Finding ID
 * @returns Query result with finding data
 */
export function useFinding(id: string | null) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.findings.detail(tenantId, id || ''),
    queryFn: () => fetchFinding(id!),
    enabled: !!id,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching findings counts by severity
 *
 * @returns Query result with severity counts
 */
export function useFindingsCounts() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: [...queryKeys.findings.lists(tenantId), 'counts'],
    queryFn: fetchFindingsCounts,
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refetch every 30 seconds
  });
}

/**
 * Hook for subscribing to real-time findings updates via SSE
 *
 * @param filters - Optional filters to scope SSE updates
 * @param onNewFinding - Callback when new finding arrives
 */
export function useFindingsSSE(
  filters: FindingsFilters = {},
  onNewFinding?: (finding: Finding) => void
) {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  useEffect(() => {
    const connectSSE = () => {
      // Build SSE URL with filters
      const params = new URLSearchParams();
      if (filters.missionId) {
        params.set('missionId', filters.missionId);
      }

      const url = `/api/findings/stream${params.toString() ? `?${params.toString()}` : ''}`;

      try {
        const eventSource = new EventSource(url);
        eventSourceRef.current = eventSource;

        eventSource.onopen = () => {
          reconnectAttemptsRef.current = 0;
        };

        eventSource.onmessage = (event) => {
          try {
            const finding: Finding = JSON.parse(event.data);

            // Convert date strings to Date objects
            finding.discoveredAt = new Date(finding.discoveredAt);

            // Add new finding to cache (prepend to list)
            queryClient.setQueryData<PaginatedResponse<Finding>>(
              queryKeys.findings.list(tenantId, filters),
              (oldData) => {
                if (!oldData) return oldData;

                return {
                  ...oldData,
                  data: [finding, ...oldData.data],
                  total: oldData.total + 1,
                };
              }
            );

            // Invalidate counts query to refresh
            queryClient.invalidateQueries({
              queryKey: [...queryKeys.findings.lists(tenantId), 'counts'],
            });

            // Call callback if provided
            if (onNewFinding) {
              onNewFinding(finding);
            }
          } catch {
            // Silently discard unparseable SSE frames
          }
        };

        eventSource.onerror = () => {
          eventSource.close();

          // Exponential backoff for reconnection
          const backoffMs = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;

          reconnectTimeoutRef.current = setTimeout(() => {
            connectSSE();
          }, backoffMs);
        };
      } catch {
        // EventSource creation failed; reconnect will be attempted on next mount
      }
    };

    // Connect on mount
    connectSSE();

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [filters.missionId, queryClient, onNewFinding]);

  return {
    isConnected: typeof EventSource !== 'undefined' && eventSourceRef.current?.readyState === EventSource.OPEN,
    disconnect: () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    },
  };
}
