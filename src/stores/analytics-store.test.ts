/**
 * Analytics Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAnalyticsStore, type WebSocketUpdate } from './analytics-store';
import type { KPIData } from '@/src/types/analytics';

const mockKPIData: KPIData = {
  totalMissions: {
    allTime: 250,
    thisMonth: 45,
    thisWeek: 10,
  },
  activeMissions: 8,
  missionSuccessRate: 87.5,
  averageMissionDuration: 1800,
  agentUtilization: {
    busy: 6,
    idle: 4,
    percentage: 60,
  },
  findingsSummary: {
    critical: 12,
    high: 45,
    medium: 120,
    low: 89,
  },
  newFindingsTrend: {
    last24h: 15,
    previous24h: 12,
    changePercent: 25,
  },
  criticalFindingsAged: 3,
};

describe('Analytics Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAnalyticsStore.setState({
      kpis: null,
      chartDataCache: new Map(),
      pendingUpdates: [],
      lastUpdateAt: 0,
      isStale: false,
    });
  });

  describe('setKPIs', () => {
    it('should set KPI data', () => {
      const store = useAnalyticsStore.getState();
      store.setKPIs(mockKPIData);

      const state = useAnalyticsStore.getState();
      expect(state.kpis).toEqual(mockKPIData);
      expect(state.isStale).toBe(false);
      expect(state.lastUpdateAt).toBeGreaterThan(0);
    });

    it('should update lastUpdateAt timestamp', () => {
      const store = useAnalyticsStore.getState();
      const beforeTime = Date.now();

      store.setKPIs(mockKPIData);

      const state = useAnalyticsStore.getState();
      expect(state.lastUpdateAt).toBeGreaterThanOrEqual(beforeTime);
      expect(state.lastUpdateAt).toBeLessThanOrEqual(Date.now());
    });

    it('should reset isStale flag', () => {
      const store = useAnalyticsStore.getState();
      store.setStale(true);

      store.setKPIs(mockKPIData);

      const state = useAnalyticsStore.getState();
      expect(state.isStale).toBe(false);
    });
  });

  describe('updateKPI', () => {
    beforeEach(() => {
      const store = useAnalyticsStore.getState();
      store.setKPIs(mockKPIData);
    });

    it('should update a specific KPI field', () => {
      const store = useAnalyticsStore.getState();
      store.updateKPI('activeMissions', 10);

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.activeMissions).toBe(10);
      expect(state.kpis?.missionSuccessRate).toBe(87.5); // Other fields unchanged
    });

    it('should update nested KPI fields', () => {
      const store = useAnalyticsStore.getState();
      const newUtilization = {
        busy: 8,
        idle: 2,
        percentage: 80,
      };

      store.updateKPI('agentUtilization', newUtilization);

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.agentUtilization).toEqual(newUtilization);
    });

    it('should update lastUpdateAt when updating KPI', () => {
      const store = useAnalyticsStore.getState();
      const beforeTime = Date.now();

      store.updateKPI('activeMissions', 15);

      const state = useAnalyticsStore.getState();
      expect(state.lastUpdateAt).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should not update if no KPIs are loaded', () => {
      // Reset to null KPIs
      useAnalyticsStore.setState({ kpis: null });

      const store = useAnalyticsStore.getState();
      store.updateKPI('activeMissions', 20);

      const state = useAnalyticsStore.getState();
      expect(state.kpis).toBeNull();
    });
  });

  describe('applyRealtimeUpdate', () => {
    it('should add update to pending updates buffer', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'kpi_update',
        timestamp: new Date().toISOString(),
        payload: { activeMissions: 10 },
      };

      store.applyRealtimeUpdate(update);

      const state = useAnalyticsStore.getState();
      expect(state.pendingUpdates).toHaveLength(1);
      expect(state.pendingUpdates[0]).toEqual(update);
    });

    it('should accumulate multiple updates', () => {
      const store = useAnalyticsStore.getState();
      const update1: WebSocketUpdate = {
        type: 'kpi_update',
        timestamp: new Date().toISOString(),
        payload: { activeMissions: 10 },
      };
      const update2: WebSocketUpdate = {
        type: 'finding_created',
        timestamp: new Date().toISOString(),
        payload: { severity: 'critical' },
      };

      store.applyRealtimeUpdate(update1);
      store.applyRealtimeUpdate(update2);

      const state = useAnalyticsStore.getState();
      expect(state.pendingUpdates).toHaveLength(2);
    });
  });

  describe('flushPendingUpdates', () => {
    beforeEach(() => {
      const store = useAnalyticsStore.getState();
      store.setKPIs(mockKPIData);
    });

    it('should process kpi_update type', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'kpi_update',
        timestamp: new Date().toISOString(),
        payload: { activeMissions: 15 },
      };

      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.activeMissions).toBe(15);
      expect(state.pendingUpdates).toHaveLength(0);
    });

    it('should process mission_status update for running mission', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'mission_status',
        timestamp: new Date().toISOString(),
        payload: { status: 'running' },
      };

      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.activeMissions).toBe(9); // 8 + 1
    });

    it('should process mission_status update for completed mission', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'mission_status',
        timestamp: new Date().toISOString(),
        payload: { completed: true },
      };

      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.activeMissions).toBe(7); // 8 - 1
    });

    it('should process finding_created update', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'finding_created',
        timestamp: new Date().toISOString(),
        payload: { severity: 'critical' },
      };

      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.findingsSummary.critical).toBe(13); // 12 + 1
      expect(state.kpis?.newFindingsTrend.last24h).toBe(16); // 15 + 1
    });

    it('should process agent_health update', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'agent_health',
        timestamp: new Date().toISOString(),
        payload: {
          status: 'busy',
          previousStatus: 'idle',
        },
      };

      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.kpis?.agentUtilization.busy).toBe(7); // 6 + 1
      expect(state.kpis?.agentUtilization.idle).toBe(3); // 4 - 1
    });

    it('should clear pending updates after flush', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'kpi_update',
        timestamp: new Date().toISOString(),
        payload: { activeMissions: 15 },
      };

      store.applyRealtimeUpdate(update);
      expect(useAnalyticsStore.getState().pendingUpdates).toHaveLength(1);

      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.pendingUpdates).toHaveLength(0);
    });

    it('should update lastUpdateAt after flush', () => {
      const store = useAnalyticsStore.getState();
      const update: WebSocketUpdate = {
        type: 'kpi_update',
        timestamp: new Date().toISOString(),
        payload: { activeMissions: 15 },
      };

      const beforeTime = Date.now();
      store.applyRealtimeUpdate(update);
      store.flushPendingUpdates();

      const state = useAnalyticsStore.getState();
      expect(state.lastUpdateAt).toBeGreaterThanOrEqual(beforeTime);
    });

    it('should do nothing if no pending updates', () => {
      const store = useAnalyticsStore.getState();
      const beforeKpis = useAnalyticsStore.getState().kpis;

      store.flushPendingUpdates();

      const afterKpis = useAnalyticsStore.getState().kpis;
      expect(afterKpis).toEqual(beforeKpis);
    });
  });

  describe('chart data cache', () => {
    it('should set chart data in cache', () => {
      const store = useAnalyticsStore.getState();
      const chartData = { data: [1, 2, 3] };

      store.setChartData('findings-line', chartData);

      const state = useAnalyticsStore.getState();
      expect(state.chartDataCache.get('findings-line')?.data).toEqual(chartData);
    });

    it('should get chart data from cache', () => {
      const store = useAnalyticsStore.getState();
      const chartData = { data: [1, 2, 3] };

      store.setChartData('findings-line', chartData);

      const retrieved = store.getChartData('findings-line');
      expect(retrieved).toEqual(chartData);
    });

    it('should return null for non-existent cache key', () => {
      const store = useAnalyticsStore.getState();
      const retrieved = store.getChartData('non-existent');

      expect(retrieved).toBeNull();
    });

    it('should respect TTL and return null for expired cache', () => {
      const store = useAnalyticsStore.getState();
      const chartData = { data: [1, 2, 3] };

      // Set with 1ms TTL
      store.setChartData('findings-line', chartData, 1);

      // Wait for expiration
      const retrieved = new Promise((resolve) => {
        setTimeout(() => {
          resolve(store.getChartData('findings-line'));
        }, 10);
      });

      return retrieved.then((data) => {
        expect(data).toBeNull();
      });
    });

    it('should clear all chart cache', () => {
      const store = useAnalyticsStore.getState();
      store.setChartData('chart1', { data: 1 });
      store.setChartData('chart2', { data: 2 });

      store.clearChartCache();

      const state = useAnalyticsStore.getState();
      expect(state.chartDataCache.size).toBe(0);
    });

    it('should remove only expired cache entries', () => {
      const store = useAnalyticsStore.getState();

      // Set one with TTL, one without
      store.setChartData('expired', { data: 1 }, 1);
      store.setChartData('valid', { data: 2 });

      // Wait for expiration
      return new Promise((resolve) => {
        setTimeout(() => {
          store.removeExpiredCache();

          const state = useAnalyticsStore.getState();
          expect(state.chartDataCache.has('valid')).toBe(true);
          resolve(undefined);
        }, 10);
      });
    });
  });

  describe('setStale', () => {
    it('should mark data as stale', () => {
      const store = useAnalyticsStore.getState();
      store.setStale(true);

      const state = useAnalyticsStore.getState();
      expect(state.isStale).toBe(true);
    });

    it('should unmark data as stale', () => {
      const store = useAnalyticsStore.getState();
      store.setStale(true);
      store.setStale(false);

      const state = useAnalyticsStore.getState();
      expect(state.isStale).toBe(false);
    });
  });
});
