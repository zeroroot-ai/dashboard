/**
 * Analytics Store
 * Zustand store for managing analytics data and real-time updates
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { KPIData } from '@/src/types/analytics';

// ============================================================================
// WebSocket Update Types
// ============================================================================

export type WebSocketUpdateType =
  | 'kpi_update'
  | 'mission_status'
  | 'finding_created'
  | 'agent_health'
  | 'component_health'
  | 'alert_new';

export interface WebSocketUpdate {
  type: WebSocketUpdateType;
  timestamp: string;
  payload: unknown;
}

// ============================================================================
// Chart Data Cache Types
// ============================================================================

interface ChartDataCacheEntry {
  data: unknown;
  timestamp: number;
  ttl?: number; // Time-to-live in milliseconds
}

// ============================================================================
// Store State
// ============================================================================

interface AnalyticsState {
  // KPI Data
  kpis: KPIData | null;

  // Chart data cache
  chartDataCache: Map<string, ChartDataCacheEntry>;

  // Pending updates buffer for batching
  pendingUpdates: WebSocketUpdate[];

  // Timestamps
  lastUpdateAt: number;

  // Staleness tracking
  isStale: boolean;

  // Actions
  setKPIs: (kpis: KPIData) => void;
  updateKPI: <K extends keyof KPIData>(key: K, value: KPIData[K]) => void;
  applyRealtimeUpdate: (update: WebSocketUpdate) => void;
  flushPendingUpdates: () => void;
  setStale: (isStale: boolean) => void;

  // Chart cache actions
  setChartData: (key: string, data: unknown, ttl?: number) => void;
  getChartData: (key: string) => unknown | null;
  clearChartCache: () => void;
  removeExpiredCache: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useAnalyticsStore = create<AnalyticsState>((set, get) => ({
  // Initial state
  kpis: null,
  chartDataCache: new Map(),
  pendingUpdates: [],
  lastUpdateAt: 0,
  isStale: false,

  // Set complete KPI data
  setKPIs: (kpis: KPIData) => {
    set({
      kpis,
      lastUpdateAt: Date.now(),
      isStale: false,
    });
  },

  // Update a specific KPI field (for incremental updates)
  updateKPI: <K extends keyof KPIData>(key: K, value: KPIData[K]) => {
    const currentKpis = get().kpis;

    if (!currentKpis) {
      console.warn('[Analytics Store] Cannot update KPI: No KPIs loaded');
      return;
    }

    set({
      kpis: {
        ...currentKpis,
        [key]: value,
      },
      lastUpdateAt: Date.now(),
    });
  },

  // Apply a real-time update to the store
  applyRealtimeUpdate: (update: WebSocketUpdate) => {
    const { pendingUpdates } = get();

    // Add to pending updates buffer
    set({
      pendingUpdates: [...pendingUpdates, update],
    });
  },

  // Process all pending updates
  flushPendingUpdates: () => {
    const { pendingUpdates, kpis } = get();

    if (pendingUpdates.length === 0) return;

    let updatedKpis = kpis;

    // Process each update
    for (const update of pendingUpdates) {
      try {
        // Apply the update based on type
        updatedKpis = applyUpdateToKPIs(updatedKpis, update);
      } catch (error) {
        console.error('[Analytics Store] Error processing update:', error, update);
      }
    }

    // Update state
    set({
      kpis: updatedKpis,
      pendingUpdates: [],
      lastUpdateAt: Date.now(),
      isStale: false,
    });
  },

  // Mark data as stale
  setStale: (isStale: boolean) => {
    set({ isStale });
  },

  // Chart cache methods
  setChartData: (key: string, data: unknown, ttl?: number) => {
    const { chartDataCache } = get();
    const newCache = new Map(chartDataCache);

    newCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });

    set({ chartDataCache: newCache });
  },

  getChartData: (key: string): unknown | null => {
    const { chartDataCache } = get();
    const entry = chartDataCache.get(key);

    if (!entry) return null;

    // Check if expired
    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      return null;
    }

    return entry.data;
  },

  clearChartCache: () => {
    set({ chartDataCache: new Map() });
  },

  removeExpiredCache: () => {
    const { chartDataCache } = get();
    const newCache = new Map<string, ChartDataCacheEntry>();
    const now = Date.now();

    for (const [key, entry] of chartDataCache.entries()) {
      // Keep if no TTL or not expired
      if (!entry.ttl || now - entry.timestamp <= entry.ttl) {
        newCache.set(key, entry);
      }
    }

    set({ chartDataCache: newCache });
  },
}));

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Apply a WebSocket update to KPIs
 * Returns updated KPIs or original if update doesn't apply
 */
function applyUpdateToKPIs(
  kpis: KPIData | null,
  update: WebSocketUpdate
): KPIData | null {
  if (!kpis) return kpis;

  const { type, payload } = update;

  switch (type) {
    case 'kpi_update': {
      // Full or partial KPI update
      return {
        ...kpis,
        ...(payload as Partial<KPIData>),
      };
    }

    case 'mission_status': {
      // Update mission-related KPIs
      const missionUpdate = payload as {
        status?: string;
        completed?: boolean;
        success?: boolean;
      };

      if (missionUpdate.status === 'running') {
        return {
          ...kpis,
          activeMissions: kpis.activeMissions + 1,
        };
      }

      if (missionUpdate.completed) {
        return {
          ...kpis,
          activeMissions: Math.max(0, kpis.activeMissions - 1),
        };
      }

      return kpis;
    }

    case 'finding_created': {
      // Update findings summary
      const finding = payload as {
        severity: 'critical' | 'high' | 'medium' | 'low';
      };

      return {
        ...kpis,
        findingsSummary: {
          ...kpis.findingsSummary,
          [finding.severity]: kpis.findingsSummary[finding.severity] + 1,
        },
        newFindingsTrend: {
          ...kpis.newFindingsTrend,
          last24h: kpis.newFindingsTrend.last24h + 1,
        },
      };
    }

    case 'agent_health': {
      // Update agent utilization
      const agentUpdate = payload as {
        status: 'idle' | 'busy' | 'degraded' | 'unhealthy';
        previousStatus?: string;
      };

      const util = { ...kpis.agentUtilization };

      // Decrement previous status
      if (agentUpdate.previousStatus === 'busy') {
        util.busy = Math.max(0, util.busy - 1);
      } else if (agentUpdate.previousStatus === 'idle') {
        util.idle = Math.max(0, util.idle - 1);
      }

      // Increment new status
      if (agentUpdate.status === 'busy') {
        util.busy++;
      } else if (agentUpdate.status === 'idle') {
        util.idle++;
      }

      // Recalculate percentage
      const total = util.busy + util.idle;
      util.percentage = total > 0 ? (util.busy / total) * 100 : 0;

      return {
        ...kpis,
        agentUtilization: util,
      };
    }

    default:
      // Unknown update type, return unchanged
      return kpis;
  }
}

// ============================================================================
// Selectors (convenience hooks)
// ============================================================================

/**
 * Hook to get KPIs
 */
const useKPIsData = () => useAnalyticsStore((state) => state.kpis);

/**
 * Hook to check if data is stale
 */
const useIsStale = () => useAnalyticsStore((state) => state.isStale);

/**
 * Hook to get last update timestamp
 */
const useLastUpdate = () => useAnalyticsStore((state) => state.lastUpdateAt);

/**
 * Hook to get analytics actions
 */
const useAnalyticsActions = () =>
  useAnalyticsStore(
    useShallow((state) => ({
      setKPIs: state.setKPIs,
      updateKPI: state.updateKPI,
      applyRealtimeUpdate: state.applyRealtimeUpdate,
      flushPendingUpdates: state.flushPendingUpdates,
      setStale: state.setStale,
      setChartData: state.setChartData,
      getChartData: state.getChartData,
      clearChartCache: state.clearChartCache,
      removeExpiredCache: state.removeExpiredCache,
    }))
  );
