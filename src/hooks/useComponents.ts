"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/src/lib/query/keys";
import { useTenantStore } from "@/src/stores/tenant-store";
import type { ComponentHealth, ComponentStatus } from "@/src/types";

const STALE_TIME = 30000; // 30 seconds

/**
 * Component counts aggregated by status
 */
export interface ComponentCounts {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
}

/**
 * All component counts by type
 */
export interface AllComponentCounts {
  agents: ComponentCounts;
  tools: ComponentCounts;
  plugins: ComponentCounts;
}

/**
 * Fetch agents from API
 */
async function fetchAgents(): Promise<ComponentHealth[]> {
  const response = await fetch("/api/components/agents");
  if (!response.ok) {
    throw new Error(`Failed to fetch agents: ${response.statusText}`);
  }
  const data = await response.json();
  return data.agents || [];
}

/**
 * Fetch tools from API
 */
async function fetchTools(): Promise<ComponentHealth[]> {
  const response = await fetch("/api/components/tools");
  if (!response.ok) {
    throw new Error(`Failed to fetch tools: ${response.statusText}`);
  }
  const data = await response.json();
  return data.tools || [];
}

/**
 * Fetch plugins from API
 */
async function fetchPlugins(): Promise<ComponentHealth[]> {
  const response = await fetch("/api/components/plugins");
  if (!response.ok) {
    throw new Error(`Failed to fetch plugins: ${response.statusText}`);
  }
  const data = await response.json();
  return data.plugins || [];
}

/**
 * Calculate counts by status for a list of components
 */
function calculateCounts(components: ComponentHealth[]): ComponentCounts {
  return {
    total: components.length,
    healthy: components.filter((c) => c.status === "healthy").length,
    degraded: components.filter((c) => c.status === "degraded").length,
    unhealthy: components.filter((c) => c.status === "unhealthy").length,
    unknown: components.filter((c) => c.status === "unknown").length,
  };
}

/**
 * Hook to fetch agents
 * Configured with 30s stale time for automatic background refresh
 */
export function useAgents() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.agents.list(tenantId),
    queryFn: fetchAgents,
    staleTime: STALE_TIME,
    refetchInterval: STALE_TIME,
  });
}

/**
 * Hook to fetch tools
 * Configured with 30s stale time for automatic background refresh
 */
export function useTools() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.tools.list(tenantId),
    queryFn: fetchTools,
    staleTime: STALE_TIME,
    refetchInterval: STALE_TIME,
  });
}

/**
 * Hook to fetch plugins
 * Configured with 30s stale time for automatic background refresh
 */
export function usePlugins() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.plugins.list(tenantId),
    queryFn: fetchPlugins,
    staleTime: STALE_TIME,
    refetchInterval: STALE_TIME,
  });
}

/**
 * Hook to get aggregate counts for all component types
 * Derives data from the existing queries' cache
 */
export function useComponentCounts() {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';
  const { data: agents = [], isLoading: agentsLoading } = useAgents();
  const { data: tools = [], isLoading: toolsLoading } = useTools();
  const { data: plugins = [], isLoading: pluginsLoading } = usePlugins();

  return useQuery({
    queryKey: [...queryKeys.agents.lists(tenantId), 'counts'],
    queryFn: (): AllComponentCounts => ({
      agents: calculateCounts(agents),
      tools: calculateCounts(tools),
      plugins: calculateCounts(plugins),
    }),
    enabled: !agentsLoading && !toolsLoading && !pluginsLoading,
    staleTime: STALE_TIME,
  });
}

/**
 * Hook to fetch a single component by ID across all types
 */
export function useComponent(id: string) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.agents.detail(tenantId, id),
    queryFn: async (): Promise<ComponentHealth | null> => {
      // Try to find in agents, tools, and plugins
      const [agents, tools, plugins] = await Promise.all([
        fetchAgents(),
        fetchTools(),
        fetchPlugins(),
      ]);

      const all = [...agents, ...tools, ...plugins];
      return all.find((c) => c.id === id) || null;
    },
    staleTime: STALE_TIME,
    enabled: !!id,
  });
}

/**
 * Hook to get components filtered by status
 */
export function useComponentsByStatus(status: ComponentStatus) {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';
  const { data: agents = [] } = useAgents();
  const { data: tools = [] } = useTools();
  const { data: plugins = [] } = usePlugins();

  return useQuery({
    queryKey: [...queryKeys.agents.lists(tenantId), 'by-status', status],
    queryFn: () => {
      const all = [...agents, ...tools, ...plugins];
      return all.filter((c) => c.status === status);
    },
    staleTime: STALE_TIME,
  });
}
