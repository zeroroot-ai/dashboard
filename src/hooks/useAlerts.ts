'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult, type UseMutationResult } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import { useAlertsStore } from '@/src/stores/alerts-store';
import type { Alert } from '@/src/types/analytics';

// ============================================================================
// API Client Functions
// ============================================================================

interface AlertsResponse {
  alerts: Alert[];
}

interface MarkAsReadResponse {
  success: boolean;
  alertId: string;
  message: string;
}

interface MarkAllAsReadResponse {
  success: boolean;
  message: string;
}

/**
 * Fetch alerts with optional filters
 */
async function fetchAlerts(options?: { limit?: number; unreadOnly?: boolean }): Promise<Alert[]> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.append('limit', options.limit.toString());
  }

  if (options?.unreadOnly) {
    params.append('unreadOnly', 'true');
  }

  const url = `/api/alerts${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch alerts: ${response.statusText}`);
  }

  const data: AlertsResponse = await response.json();
  return data.alerts;
}

/**
 * Mark a single alert as read
 */
async function markAlertAsRead(alertId: string): Promise<MarkAsReadResponse> {
  const response = await fetch(`/api/alerts/${alertId}/read`, {
    method: 'PATCH',
  });

  if (!response.ok) {
    throw new Error(`Failed to mark alert as read: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Mark all alerts as read
 */
async function markAllAlertsAsRead(): Promise<MarkAllAsReadResponse> {
  const response = await fetch('/api/alerts/mark-all-read', {
    method: 'PATCH',
  });

  if (!response.ok) {
    throw new Error(`Failed to mark all alerts as read: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook for fetching alerts with optional filtering
 *
 * Automatically syncs alerts to the alerts store on query success.
 *
 * @param options - Optional filters (limit, unreadOnly)
 * @returns Query result with alerts data
 *
 * @example
 * ```tsx
 * function AlertsList() {
 *   const { data: alerts, isLoading, error } = useAlerts({ limit: 20, unreadOnly: true });
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *
 *   return (
 *     <div>
 *       {alerts?.map(alert => (
 *         <AlertItem key={alert.id} alert={alert} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAlerts(options?: { limit?: number; unreadOnly?: boolean }): UseQueryResult<Alert[], Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery<Alert[], Error>({
    queryKey: queryKeys.alerts.list(tenantId, options),
    queryFn: () => fetchAlerts(options),
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Auto-refetch every 60s for real-time updates
    select: (data) => {
      // Ensure timestamp is a Date object
      return data.map((alert) => ({
        ...alert,
        timestamp: new Date(alert.timestamp),
      }));
    },
  });
}

/**
 * Hook for marking a single alert as read
 *
 * Optimistically updates the UI and syncs with the alerts store.
 *
 * @returns Mutation function and state
 *
 * @example
 * ```tsx
 * function AlertItem({ alert }) {
 *   const { mutate: markAsRead } = useMarkAsRead();
 *
 *   const handleClick = () => {
 *     markAsRead(alert.id);
 *   };
 *
 *   return (
 *     <div onClick={handleClick}>
 *       {alert.title}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMarkAsRead(): UseMutationResult<MarkAsReadResponse, Error, string> {
  const queryClient = useQueryClient();
  const markAsRead = useAlertsStore((state) => state.markAsRead);
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: markAlertAsRead,
    // Optimistic update
    onMutate: async (alertId) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.alerts.all });

      // Snapshot previous value
      const previousAlerts = queryClient.getQueryData<Alert[]>(queryKeys.alerts.lists(tenantId));

      // Optimistically update cache
      queryClient.setQueriesData<Alert[]>({ queryKey: queryKeys.alerts.all }, (old) => {
        if (!old) return old;
        return old.map((alert) =>
          alert.id === alertId ? { ...alert, read: true } : alert
        );
      });

      // Update store
      markAsRead(alertId);

      return { previousAlerts };
    },
    // On error, rollback
    onError: (err, alertId, context) => {
      if (context?.previousAlerts) {
        queryClient.setQueryData(queryKeys.alerts.lists(tenantId), context.previousAlerts);
      }
      console.error('Failed to mark alert as read:', err);
    },
    // Refetch after success
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}

/**
 * Hook for marking all alerts as read
 *
 * Optimistically updates the UI and syncs with the alerts store.
 *
 * @returns Mutation function and state
 *
 * @example
 * ```tsx
 * function AlertsHeader() {
 *   const { mutate: markAllAsRead, isPending } = useMarkAllAsRead();
 *
 *   return (
 *     <button onClick={() => markAllAsRead()} disabled={isPending}>
 *       Mark all as read
 *     </button>
 *   );
 * }
 * ```
 */
export function useMarkAllAsRead(): UseMutationResult<MarkAllAsReadResponse, Error, void> {
  const queryClient = useQueryClient();
  const markAllAsRead = useAlertsStore((state) => state.markAllAsRead);
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: markAllAlertsAsRead,
    // Optimistic update
    onMutate: async () => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: queryKeys.alerts.all });

      // Snapshot previous value
      const previousAlerts = queryClient.getQueryData<Alert[]>(queryKeys.alerts.lists(tenantId));

      // Optimistically update cache
      queryClient.setQueriesData<Alert[]>({ queryKey: queryKeys.alerts.all }, (old) => {
        if (!old) return old;
        return old.map((alert) => ({ ...alert, read: true }));
      });

      // Update store
      markAllAsRead();

      return { previousAlerts };
    },
    // On error, rollback
    onError: (err, _, context) => {
      if (context?.previousAlerts) {
        queryClient.setQueryData(queryKeys.alerts.lists(tenantId), context.previousAlerts);
      }
      console.error('Failed to mark all alerts as read:', err);
    },
    // Refetch after success
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all });
    },
  });
}
