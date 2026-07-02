'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantStore } from '@/src/stores/tenant-store';
import type {
  KPIData,
  FindingsOverTime,
  SeverityDistribution,
  CategoryCount,
  MissionHeatmap,
  AgentPerformance,
  TimeRange,
} from '@/src/types';

// ============================================================================
// API Client Functions
// ============================================================================

/**
 * Fetch KPI data
 */
async function fetchKPIs(): Promise<KPIData> {
  const response = await fetch('/api/analytics/kpis');

  if (!response.ok) {
    throw new Error(`Failed to fetch KPIs: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch findings time series data
 */
async function fetchFindingsTimeSeries(timeRange: TimeRange): Promise<FindingsOverTime> {
  const response = await fetch(`/api/analytics/findings/time-series?timeRange=${timeRange}`);

  if (!response.ok) {
    throw new Error(`Failed to fetch findings time series: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch findings severity distribution
 */
async function fetchFindingsSeverity(): Promise<SeverityDistribution> {
  const response = await fetch('/api/analytics/findings/by-severity');

  if (!response.ok) {
    throw new Error(`Failed to fetch findings severity: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch findings by category
 */
async function fetchFindingsCategory(): Promise<CategoryCount[]> {
  const response = await fetch('/api/analytics/findings/by-category');

  if (!response.ok) {
    throw new Error(`Failed to fetch findings by category: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch mission heatmap data
 */
async function fetchMissionHeatmap(): Promise<MissionHeatmap> {
  const response = await fetch('/api/analytics/missions/heatmap');

  if (!response.ok) {
    throw new Error(`Failed to fetch mission heatmap: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch agent performance data
 */
async function fetchAgentPerformance(): Promise<AgentPerformance[]> {
  const response = await fetch('/api/analytics/agents/performance');

  if (!response.ok) {
    throw new Error(`Failed to fetch agent performance: ${response.statusText}`);
  }

  return response.json();
}

// ============================================================================
// React Query Hooks
// ============================================================================

/**
 * Hook for fetching KPI data
 *
 * Automatically refetches every 30 seconds for real-time dashboard updates.
 *
 * @returns Query result with KPI data
 *
 * @example
 * ```tsx
 * function Dashboard() {
 *   const { data, isLoading, error } = useKPIs();
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <Error message={error.message} />;
 *
 *   return <KPICards data={data} />;
 * }
 * ```
 */
export function useKPIs(): UseQueryResult<KPIData, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.kpis(tenantId),
    queryFn: fetchKPIs,
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refetch every 30s for real-time updates
  });
}

/**
 * Hook for fetching findings time series data
 *
 * @param timeRange - Time range for the data ('24h' | '7d' | '30d' | '90d')
 * @returns Query result with time series data
 *
 * @example
 * ```tsx
 * function FindingsChart() {
 *   const [timeRange, setTimeRange] = useState<TimeRange>('7d');
 *   const { data, isLoading } = useFindingsTimeSeries(timeRange);
 *
 *   return (
 *     <>
 *       <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
 *       <LineChart data={data?.data} />
 *     </>
 *   );
 * }
 * ```
 */
export function useFindingsTimeSeries(
  timeRange: TimeRange = '7d'
): UseQueryResult<FindingsOverTime, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.findings.timeSeries(tenantId, timeRange),
    queryFn: () => fetchFindingsTimeSeries(timeRange),
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching findings severity distribution
 *
 * @returns Query result with severity distribution
 *
 * @example
 * ```tsx
 * function SeverityPieChart() {
 *   const { data, isLoading } = useFindingsSeverity();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return <PieChart data={data} />;
 * }
 * ```
 */
export function useFindingsSeverity(): UseQueryResult<SeverityDistribution, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.findings.bySeverity(tenantId),
    queryFn: fetchFindingsSeverity,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching findings by category
 *
 * Returns top 10 categories with severity breakdown.
 *
 * @returns Query result with category distribution
 *
 * @example
 * ```tsx
 * function CategoryBarChart() {
 *   const { data, isLoading } = useFindingsCategory();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return <BarChart data={data} />;
 * }
 * ```
 */
export function useFindingsCategory(): UseQueryResult<CategoryCount[], Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.findings.byCategory(tenantId),
    queryFn: fetchFindingsCategory,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}

/**
 * Hook for fetching mission activity heatmap
 *
 * Returns 12 weeks of mission activity data.
 *
 * @returns Query result with heatmap data
 *
 * @example
 * ```tsx
 * function ActivityHeatmap() {
 *   const { data, isLoading } = useMissionHeatmap();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return <Heatmap cells={data.cells} />;
 * }
 * ```
 */
export function useMissionHeatmap(): UseQueryResult<MissionHeatmap, Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.missions.heatmap(tenantId),
    queryFn: fetchMissionHeatmap,
    staleTime: 300000, // 5 minutes (heatmap data changes less frequently)
    gcTime: 600000, // 10 minutes
  });
}

/**
 * Hook for fetching agent performance comparison
 *
 * Returns performance metrics for all agents.
 *
 * @returns Query result with agent performance data
 *
 * @example
 * ```tsx
 * function AgentPerformanceTable() {
 *   const { data, isLoading } = useAgentPerformance();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   return (
 *     <Table>
 *       {data.map(agent => (
 *         <AgentRow key={agent.agentId} agent={agent} />
 *       ))}
 *     </Table>
 *   );
 * }
 * ```
 */
export function useAgentPerformance(): UseQueryResult<AgentPerformance[], Error> {
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  return useQuery({
    queryKey: queryKeys.analytics.agents.performance(tenantId),
    queryFn: fetchAgentPerformance,
    staleTime: 60000, // 1 minute
    gcTime: 300000, // 5 minutes
  });
}
