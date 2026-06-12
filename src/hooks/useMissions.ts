'use client';

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult
} from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import type { Mission, MissionFilters, PaginatedResponse } from '@/src/types';

// API client functions
//
// Tenant context is NOT passed via the URL (dashboard#209). The
// /api/missions route resolves the active tenant via requireActiveTenant()
// (HMAC-signed cookie). The daemon trusts the X-Gibson-Identity-Tenant
// header injected by ext-authz, not URL params. Leaving tenantId in
// the URL would only leak the tenant slug into browser history /
// referer / access logs.
//
// `_tenantId` is kept as a parameter for query-key compatibility with
// existing useTenantStore usage; the value is unused.
async function fetchMissions(filters?: MissionFilters, _tenantId?: string): Promise<Mission[]> {
  const params = new URLSearchParams();

  if (filters?.status && filters.status.length > 0) {
    params.set('status', filters.status.join(','));
  }
  if (filters?.search) {
    params.set('search', filters.search);
  }
  if (filters?.timeRange && filters.timeRange !== 'all') {
    params.set('timeRange', filters.timeRange);
  }

  const url = `/api/missions${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch missions: ${response.statusText}`);
  }

  const json = await response.json();
  // API returns { data: Mission[], total, page, ... }, unwrap it
  return Array.isArray(json) ? json : json.data ?? [];
}

// Cross-tenant API function for super-admins
async function fetchCrossTenantMissions(
  filters?: MissionFilters,
  tenantIds?: string[]
): Promise<Mission[]> {
  const params = new URLSearchParams();

  if (tenantIds && tenantIds.length > 0) {
    params.set('tenantIds', tenantIds.join(','));
  }

  if (filters?.status && filters.status.length > 0) {
    params.set('status', filters.status.join(','));
  }
  if (filters?.search) {
    params.set('search', filters.search);
  }
  if (filters?.timeRange && filters.timeRange !== 'all') {
    params.set('timeRange', filters.timeRange);
  }

  const url = `/api/super-admin/missions${params.toString() ? `?${params.toString()}` : ''}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch cross-tenant missions: ${response.statusText}`);
  }

  return response.json();
}

async function fetchMission(id: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${id}`);

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Mission not found');
    }
    throw new Error(`Failed to fetch mission: ${response.statusText}`);
  }

  return response.json();
}

async function startMission(missionId: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${missionId}/start`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to start mission: ${response.statusText}`);
  }

  return response.json();
}

async function pauseMission(missionId: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${missionId}/pause`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to pause mission: ${response.statusText}`);
  }

  return response.json();
}

async function resumeMission(missionId: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${missionId}/resume`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to resume mission: ${response.statusText}`);
  }

  return response.json();
}

async function stopMission(missionId: string): Promise<Mission> {
  const response = await fetch(`/api/missions/${missionId}/stop`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Failed to stop mission: ${response.statusText}`);
  }

  return response.json();
}

async function deleteMission(missionId: string): Promise<void> {
  const response = await fetch(`/api/missions/${missionId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete mission: ${response.statusText}`);
  }
}

// Hooks

/**
 * Fetch all missions with optional filters
 * Automatically scoped to the current tenant
 */
export function useMissions(
  filters?: MissionFilters
): UseQueryResult<Mission[], Error> {
  // Get current tenant from store for automatic tenant filtering
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.missions.list(tenantId, filters),
    queryFn: () => fetchMissions(filters, tenantId),
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refetch every 30s for real-time updates
  });
}

/**
 * Fetch missions across multiple tenants (super-admin only)
 */
export function useCrossTenantMissions(
  filters?: MissionFilters,
  tenantIds?: string[]
): UseQueryResult<Mission[], Error> {
  return useQuery({
    queryKey: ['cross-tenant-missions', filters, tenantIds],
    queryFn: () => fetchCrossTenantMissions(filters, tenantIds),
    staleTime: 30000,
    refetchInterval: 60000, // Less frequent for cross-tenant queries
  });
}

/**
 * Fetch a single mission by ID
 */
export function useMission(id: string): UseQueryResult<Mission, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.missions.detail(tenantId, id),
    queryFn: () => fetchMission(id),
    staleTime: 30000,
    refetchInterval: 10000, // More frequent updates for active mission detail
    enabled: !!id,
  });
}

/**
 * Start a mission with optimistic update
 */
export function useStartMission(): UseMutationResult<
  Mission,
  Error,
  string,
  { previousMissions?: Mission[] }
> {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: startMission,
    onMutate: async (missionId) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: queryKeys.missions.all });

      // Snapshot previous value
      const previousMissions = queryClient.getQueryData<Mission[]>(
        queryKeys.missions.lists(tenantId)
      );

      // Optimistically update to running status
      queryClient.setQueriesData<Mission[]>(
        { queryKey: queryKeys.missions.lists(tenantId) },
        (old) => {
          if (!old) return old;
          return old.map((mission) =>
            mission.id === missionId
              ? { ...mission, status: 'running' as const, startedAt: new Date() }
              : mission
          );
        }
      );

      // Update single mission query if exists
      queryClient.setQueryData<Mission>(
        queryKeys.missions.detail(tenantId, missionId),
        (old) => {
          if (!old) return old;
          return { ...old, status: 'running' as const, startedAt: new Date() };
        }
      );

      return { previousMissions };
    },
    onError: (err, missionId, context) => {
      // Rollback on error
      if (context?.previousMissions) {
        queryClient.setQueryData(
          queryKeys.missions.lists(tenantId),
          context.previousMissions
        );
      }
    },
    onSettled: () => {
      // Refetch after mutation
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });
    },
  });
}

/**
 * Pause a mission with optimistic update
 */
export function usePauseMission(): UseMutationResult<
  Mission,
  Error,
  string,
  { previousMissions?: Mission[] }
> {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: pauseMission,
    onMutate: async (missionId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.missions.all });

      const previousMissions = queryClient.getQueryData<Mission[]>(
        queryKeys.missions.lists(tenantId)
      );

      queryClient.setQueriesData<Mission[]>(
        { queryKey: queryKeys.missions.lists(tenantId) },
        (old) => {
          if (!old) return old;
          return old.map((mission) =>
            mission.id === missionId
              ? { ...mission, status: 'paused' as const }
              : mission
          );
        }
      );

      queryClient.setQueryData<Mission>(
        queryKeys.missions.detail(tenantId, missionId),
        (old) => {
          if (!old) return old;
          return { ...old, status: 'paused' as const };
        }
      );

      return { previousMissions };
    },
    onError: (err, missionId, context) => {
      if (context?.previousMissions) {
        queryClient.setQueryData(
          queryKeys.missions.lists(tenantId),
          context.previousMissions
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });
    },
  });
}

/**
 * Resume a paused mission with optimistic update
 */
export function useResumeMission(): UseMutationResult<
  Mission,
  Error,
  string,
  { previousMissions?: Mission[] }
> {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: resumeMission,
    onMutate: async (missionId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.missions.all });

      const previousMissions = queryClient.getQueryData<Mission[]>(
        queryKeys.missions.lists(tenantId)
      );

      queryClient.setQueriesData<Mission[]>(
        { queryKey: queryKeys.missions.lists(tenantId) },
        (old) => {
          if (!old) return old;
          return old.map((mission) =>
            mission.id === missionId
              ? { ...mission, status: 'running' as const }
              : mission
          );
        }
      );

      queryClient.setQueryData<Mission>(
        queryKeys.missions.detail(tenantId, missionId),
        (old) => {
          if (!old) return old;
          return { ...old, status: 'running' as const };
        }
      );

      return { previousMissions };
    },
    onError: (err, missionId, context) => {
      if (context?.previousMissions) {
        queryClient.setQueryData(
          queryKeys.missions.lists(tenantId),
          context.previousMissions
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });
    },
  });
}

/**
 * Stop a mission with optimistic update
 */
export function useStopMission(): UseMutationResult<
  Mission,
  Error,
  string,
  { previousMissions?: Mission[] }
> {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: stopMission,
    onMutate: async (missionId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.missions.all });

      const previousMissions = queryClient.getQueryData<Mission[]>(
        queryKeys.missions.lists(tenantId)
      );

      queryClient.setQueriesData<Mission[]>(
        { queryKey: queryKeys.missions.lists(tenantId) },
        (old) => {
          if (!old) return old;
          return old.map((mission) =>
            mission.id === missionId
              ? { ...mission, status: 'stopped' as const, completedAt: new Date() }
              : mission
          );
        }
      );

      queryClient.setQueryData<Mission>(
        queryKeys.missions.detail(tenantId, missionId),
        (old) => {
          if (!old) return old;
          return { ...old, status: 'stopped' as const, completedAt: new Date() };
        }
      );

      return { previousMissions };
    },
    onError: (err, missionId, context) => {
      if (context?.previousMissions) {
        queryClient.setQueryData(
          queryKeys.missions.lists(tenantId),
          context.previousMissions
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });
    },
  });
}

/**
 * Delete a mission with optimistic update
 */
export function useDeleteMission(): UseMutationResult<
  void,
  Error,
  string,
  { previousMissions?: Mission[] }
> {
  const queryClient = useQueryClient();
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useMutation({
    mutationFn: deleteMission,
    onMutate: async (missionId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.missions.all });

      const previousMissions = queryClient.getQueryData<Mission[]>(
        queryKeys.missions.lists(tenantId)
      );

      // Optimistically remove the mission from the list
      queryClient.setQueriesData<Mission[]>(
        { queryKey: queryKeys.missions.lists(tenantId) },
        (old) => {
          if (!old) return old;
          return old.filter((mission) => mission.id !== missionId);
        }
      );

      return { previousMissions };
    },
    onError: (err, missionId, context) => {
      if (context?.previousMissions) {
        queryClient.setQueryData(
          queryKeys.missions.lists(tenantId),
          context.previousMissions
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.missions.all });
    },
  });
}
