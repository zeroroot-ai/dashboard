'use client';

import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import { useLayoutStore } from '@/src/stores/layout-store';
import type { WidgetLayout } from '@/src/types/analytics';

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * Fetch user's widget layout from the server
 */
async function fetchLayout(): Promise<WidgetLayout> {
  const response = await fetch('/api/user/layout');

  if (!response.ok) {
    throw new Error(`Failed to fetch layout: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Save user's widget layout to the server
 */
async function saveLayout(layout: WidgetLayout): Promise<{ success: boolean; layout: WidgetLayout }> {
  const response = await fetch('/api/user/layout', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(layout),
  });

  if (!response.ok) {
    throw new Error(`Failed to save layout: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Reset user's widget layout to default
 */
async function resetLayout(): Promise<{ success: boolean; layout: WidgetLayout }> {
  const response = await fetch('/api/user/layout', {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to reset layout: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook for fetching user's widget layout
 *
 * Automatically syncs the fetched layout to the Zustand store on success.
 * This ensures the store is hydrated with the user's saved preferences.
 *
 * @returns Query result with layout data
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { data: layout, isLoading, error } = useLayoutQuery();
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *
 *   return <WidgetGrid layout={layout} />;
 * }
 * ```
 */
export function useLayoutQuery(): UseQueryResult<WidgetLayout, Error> {
  const setLayout = useLayoutStore((state) => state.setLayout);
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.user.layout(tenantId),
    queryFn: fetchLayout,
    staleTime: 300000, // 5 minutes
    gcTime: 600000, // 10 minutes
    // Sync to store on success
    select: (data) => {
      setLayout(data);
      return data;
    },
  });
}

/**
 * Hook for saving user's widget layout
 *
 * Optimistically updates the cache and Zustand store before the server responds.
 * Reverts on error.
 *
 * @returns Mutation object with save function
 *
 * @example
 * ```tsx
 * function LayoutEditor() {
 *   const { layout } = useLayout();
 *   const { mutate: saveLayout, isPending } = useSaveLayout();
 *
 *   const handleSave = () => {
 *     saveLayout(layout, {
 *       onSuccess: () => {
 *         toast.success('Layout saved!');
 *       },
 *       onError: (error) => {
 *         toast.error(error.message);
 *       },
 *     });
 *   };
 *
 *   return (
 *     <button onClick={handleSave} disabled={isPending}>
 *       {isPending ? 'Saving...' : 'Save Layout'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSaveLayout() {
  const queryClient = useQueryClient();
  const setLayout = useLayoutStore((state) => state.setLayout);
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: saveLayout,
    // Optimistic update
    onMutate: async (newLayout) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.user.layout(tenantId) });

      // Snapshot the previous value
      const previousLayout = queryClient.getQueryData<WidgetLayout>(queryKeys.user.layout(tenantId));

      // Optimistically update cache and store
      queryClient.setQueryData(queryKeys.user.layout(tenantId), newLayout);
      setLayout(newLayout);

      // Return context with previous value
      return { previousLayout };
    },
    // Revert on error
    onError: (error, newLayout, context) => {
      if (context?.previousLayout) {
        queryClient.setQueryData(queryKeys.user.layout(tenantId), context.previousLayout);
        setLayout(context.previousLayout);
      }
    },
    // Refetch on success
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.user.layout(tenantId), data.layout);
      setLayout(data.layout);
    },
  });
}

/**
 * Hook for resetting user's widget layout to default
 *
 * Clears the cache and updates the Zustand store with the default layout.
 *
 * @returns Mutation object with reset function
 *
 * @example
 * ```tsx
 * function LayoutSettings() {
 *   const { mutate: resetLayout, isPending } = useResetLayout();
 *
 *   const handleReset = () => {
 *     if (confirm('Reset layout to default? This cannot be undone.')) {
 *       resetLayout(undefined, {
 *         onSuccess: () => {
 *           toast.success('Layout reset to default');
 *         },
 *         onError: (error) => {
 *           toast.error(error.message);
 *         },
 *       });
 *     }
 *   };
 *
 *   return (
 *     <button onClick={handleReset} disabled={isPending}>
 *       {isPending ? 'Resetting...' : 'Reset to Default'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useResetLayout() {
  const queryClient = useQueryClient();
  const setLayout = useLayoutStore((state) => state.setLayout);
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: resetLayout,
    onSuccess: (data) => {
      // Update cache and store with default layout
      queryClient.setQueryData(queryKeys.user.layout(tenantId), data.layout);
      setLayout(data.layout);
    },
  });
}
