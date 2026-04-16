import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/src/test/mocks/server';
import {
  useKPIs,
  useFindingsTimeSeries,
  useFindingsSeverity,
  useFindingsCategory,
  useMissionHeatmap,
  useAgentPerformance,
} from './useAnalytics';
import type {
  KPIData,
  FindingsOverTime,
  SeverityDistribution,
  CategoryCount,
  MissionHeatmap,
  AgentPerformance,
} from '@/src/types';

// Mock data
const mockKPIData: KPIData = {
  totalMissions: {
    allTime: 250,
    thisMonth: 45,
    thisWeek: 10,
  },
  activeMissions: 8,
  missionSuccessRate: 87.5,
  averageMissionDuration: 1800, // 30 minutes
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

const mockFindingsTimeSeries: FindingsOverTime = {
  data: [
    { timestamp: '2024-03-01T00:00:00Z', critical: 2, high: 5, medium: 10, low: 8 },
    { timestamp: '2024-03-02T00:00:00Z', critical: 1, high: 6, medium: 12, low: 9 },
    { timestamp: '2024-03-03T00:00:00Z', critical: 3, high: 7, medium: 11, low: 7 },
  ],
  timeRange: '7d',
};

const mockSeverityDistribution: SeverityDistribution = {
  critical: 12,
  high: 45,
  medium: 120,
  low: 89,
  info: 34,
};

const mockCategoryCount: CategoryCount[] = [
  { category: 'Injection', critical: 5, high: 10, medium: 15, low: 8, total: 38 },
  { category: 'XSS', critical: 3, high: 8, medium: 12, low: 6, total: 29 },
  { category: 'Authentication', critical: 2, high: 5, medium: 9, low: 4, total: 20 },
];

const mockMissionHeatmap: MissionHeatmap = {
  cells: [
    { date: '2024-01-01', count: 5, successRate: 80 },
    { date: '2024-01-02', count: 8, successRate: 90 },
    { date: '2024-01-03', count: 3, successRate: 70 },
  ],
  startDate: '2024-01-01',
  endDate: '2024-03-31',
};

const mockAgentPerformance: AgentPerformance[] = [
  {
    agentId: 'agent-1',
    agentName: 'Scanner Agent',
    totalExecutions: 150,
    avgExecutionTime: 120,
    successRate: 95.5,
    findingsPerExecution: 3.2,
    status: 'busy',
  },
  {
    agentId: 'agent-2',
    agentName: 'Analysis Agent',
    totalExecutions: 200,
    avgExecutionTime: 300,
    successRate: 92.3,
    findingsPerExecution: 5.7,
    status: 'idle',
  },
];

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
}

describe('useAnalytics hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('useKPIs', () => {
    it('should fetch KPI data successfully with MSW mock', async () => {
      server.use(
        http.get('/api/analytics/kpis', () => {
          return HttpResponse.json(mockKPIData);
        })
      );

      const { result } = renderHook(() => useKPIs(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockKPIData);
      expect(result.current.data?.totalMissions.allTime).toBe(250);
      expect(result.current.data?.activeMissions).toBe(8);
      expect(result.current.data?.missionSuccessRate).toBe(87.5);
    });

    it('should handle API errors gracefully', async () => {
      server.use(
        http.get('/api/analytics/kpis', () => {
          return HttpResponse.json(
            { message: 'Internal server error' },
            { status: 500 }
          );
        })
      );

      const { result } = renderHook(() => useKPIs(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch KPIs');
    });

    it('should support refetch behavior', async () => {
      let callCount = 0;
      server.use(
        http.get('/api/analytics/kpis', () => {
          callCount++;
          return HttpResponse.json({
            ...mockKPIData,
            activeMissions: mockKPIData.activeMissions + callCount,
          });
        })
      );

      const { result } = renderHook(() => useKPIs(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.activeMissions).toBe(9); // 8 + 1

      // Refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.data?.activeMissions).toBe(10); // 8 + 2
      });

      expect(callCount).toBe(2);
    });
  });

  describe('useFindingsTimeSeries', () => {
    it('should fetch time series data for 24h timeRange', async () => {
      server.use(
        http.get('/api/analytics/findings/time-series', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('timeRange')).toBe('24h');
          return HttpResponse.json({ ...mockFindingsTimeSeries, timeRange: '24h' });
        })
      );

      const { result } = renderHook(() => useFindingsTimeSeries('24h'), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timeRange).toBe('24h');
      expect(result.current.data?.data).toBeDefined();
      expect(Array.isArray(result.current.data?.data)).toBe(true);
    });

    it('should fetch time series data for 7d timeRange', async () => {
      server.use(
        http.get('/api/analytics/findings/time-series', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('timeRange')).toBe('7d');
          return HttpResponse.json(mockFindingsTimeSeries);
        })
      );

      const { result } = renderHook(() => useFindingsTimeSeries('7d'), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timeRange).toBe('7d');
      expect(result.current.data?.data.length).toBeGreaterThan(0);
    });

    it('should fetch time series data for 30d timeRange', async () => {
      server.use(
        http.get('/api/analytics/findings/time-series', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('timeRange')).toBe('30d');
          return HttpResponse.json({ ...mockFindingsTimeSeries, timeRange: '30d' });
        })
      );

      const { result } = renderHook(() => useFindingsTimeSeries('30d'), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timeRange).toBe('30d');
    });

    it('should fetch time series data for 90d timeRange', async () => {
      server.use(
        http.get('/api/analytics/findings/time-series', ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('timeRange')).toBe('90d');
          return HttpResponse.json({ ...mockFindingsTimeSeries, timeRange: '90d' });
        })
      );

      const { result } = renderHook(() => useFindingsTimeSeries('90d'), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.timeRange).toBe('90d');
    });

    it('should handle API errors', async () => {
      server.use(
        http.get('/api/analytics/findings/time-series', () => {
          return HttpResponse.json(
            { message: 'Server error' },
            { status: 500 }
          );
        })
      );

      const { result } = renderHook(() => useFindingsTimeSeries('7d'), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch findings time series');
    });
  });

  describe('useFindingsSeverity', () => {
    it('should fetch severity distribution successfully', async () => {
      server.use(
        http.get('/api/analytics/findings/by-severity', () => {
          return HttpResponse.json(mockSeverityDistribution);
        })
      );

      const { result } = renderHook(() => useFindingsSeverity(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockSeverityDistribution);
      expect(result.current.data?.critical).toBe(12);
      expect(result.current.data?.high).toBe(45);
      expect(result.current.data?.medium).toBe(120);
      expect(result.current.data?.low).toBe(89);
      expect(result.current.data?.info).toBe(34);
    });

    it('should handle API errors', async () => {
      server.use(
        http.get('/api/analytics/findings/by-severity', () => {
          return HttpResponse.json(
            { message: 'Not found' },
            { status: 404 }
          );
        })
      );

      const { result } = renderHook(() => useFindingsSeverity(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch findings severity');
    });
  });

  describe('useFindingsCategory', () => {
    it('should fetch category distribution successfully', async () => {
      server.use(
        http.get('/api/analytics/findings/by-category', () => {
          return HttpResponse.json(mockCategoryCount);
        })
      );

      const { result } = renderHook(() => useFindingsCategory(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockCategoryCount);
      expect(Array.isArray(result.current.data)).toBe(true);
      expect(result.current.data?.length).toBe(3);
      expect(result.current.data?.[0].category).toBe('Injection');
    });

    it('should handle API errors', async () => {
      server.use(
        http.get('/api/analytics/findings/by-category', () => {
          return HttpResponse.json(
            { message: 'Service unavailable' },
            { status: 503 }
          );
        })
      );

      const { result } = renderHook(() => useFindingsCategory(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch findings by category');
    });
  });

  describe('useMissionHeatmap', () => {
    it('should fetch mission heatmap data successfully', async () => {
      server.use(
        http.get('/api/analytics/missions/heatmap', () => {
          return HttpResponse.json(mockMissionHeatmap);
        })
      );

      const { result } = renderHook(() => useMissionHeatmap(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockMissionHeatmap);
      expect(result.current.data?.cells).toBeDefined();
      expect(Array.isArray(result.current.data?.cells)).toBe(true);
      expect(result.current.data?.cells.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle API errors', async () => {
      server.use(
        http.get('/api/analytics/missions/heatmap', () => {
          return HttpResponse.json(
            { message: 'Unauthorized' },
            { status: 401 }
          );
        })
      );

      const { result } = renderHook(() => useMissionHeatmap(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch mission heatmap');
    });
  });

  describe('useAgentPerformance', () => {
    it('should fetch agent performance data successfully', async () => {
      server.use(
        http.get('/api/analytics/agents/performance', () => {
          return HttpResponse.json(mockAgentPerformance);
        })
      );

      const { result } = renderHook(() => useAgentPerformance(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockAgentPerformance);
      expect(Array.isArray(result.current.data)).toBe(true);
      expect(result.current.data?.length).toBe(2);
      expect(result.current.data?.[0].agentName).toBe('Scanner Agent');
      expect(result.current.data?.[0].successRate).toBe(95.5);
    });

    it('should handle API errors', async () => {
      server.use(
        http.get('/api/analytics/agents/performance', () => {
          return HttpResponse.json(
            { message: 'Gateway timeout' },
            { status: 504 }
          );
        })
      );

      const { result } = renderHook(() => useAgentPerformance(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to fetch agent performance');
    });

    it('should support refetch behavior', async () => {
      let callCount = 0;
      server.use(
        http.get('/api/analytics/agents/performance', () => {
          callCount++;
          return HttpResponse.json(
            mockAgentPerformance.map((agent) => ({
              ...agent,
              totalExecutions: agent.totalExecutions + callCount * 10,
            }))
          );
        })
      );

      const { result } = renderHook(() => useAgentPerformance(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.[0].totalExecutions).toBe(160); // 150 + 10

      // Refetch
      await result.current.refetch();

      await waitFor(() => {
        expect(result.current.data?.[0].totalExecutions).toBe(170); // 150 + 20
      });

      expect(callCount).toBe(2);
    });
  });
});
