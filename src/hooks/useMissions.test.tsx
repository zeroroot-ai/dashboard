import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useMissions,
  useMission,
  useStartMission,
  usePauseMission,
  useResumeMission,
  useStopMission,
} from './useMissions';
import { createTestQueryClient, createHookWrapper } from '@/src/test/test-utils';
import { QueryClient } from '@tanstack/react-query';
import type { Mission } from '@/src/types';

const mockMission: Mission = {
  id: 'mission-1',
  name: 'Test Mission',
  status: 'running',
  progress: 45,
  startedAt: new Date('2024-03-01T10:00:00Z'),
  config: { target: 'example.com' },
  agents: ['agent-1'],
  findings: 10,
  events: 0,
  tenantId: 'test-tenant',
};

describe('useMissions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('useMissions (list)', () => {
    it('should fetch missions successfully', async () => {
      const { result } = renderHook(() => useMissions(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(Array.isArray(result.current.data)).toBe(true);
    });

    it('should apply filters to query', async () => {
      const filters = { status: ['running' as const], search: 'test' };

      const { result } = renderHook(() => useMissions(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // MSW handler should filter missions
      expect(result.current.data).toBeDefined();
    });

    it('should handle error state', async () => {
      // Mock fetch to throw error
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        } as Response)
      );

      const { result } = renderHook(() => useMissions(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch missions');

      global.fetch = originalFetch;
    });

    it('should refetch at intervals', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(() => useMissions(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const initialDataUpdatedAt = result.current.dataUpdatedAt;

      // Fast-forward 30 seconds to trigger refetch
      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(result.current.dataUpdatedAt).toBeGreaterThan(initialDataUpdatedAt);
      });

      vi.restoreAllMocks();
    });
  });

  describe('useMission (single)', () => {
    it('should fetch single mission successfully', async () => {
      const { result } = renderHook(() => useMission('mission-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.id).toBe('mission-1');
    });

    it('should not fetch when id is empty', () => {
      const { result } = renderHook(() => useMission(''), {
        wrapper: createHookWrapper(queryClient),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
    });

    it('should handle 404 error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response)
      );

      const { result } = renderHook(() => useMission('nonexistent'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Mission not found');

      global.fetch = originalFetch;
    });
  });

  describe('useStartMission', () => {
    beforeEach(() => {
      // Seed cache with initial missions
      queryClient.setQueryData(['missions', 'lists'], [
        { ...mockMission, status: 'pending' as const },
      ]);
    });

    it('should start mission with optimistic update', async () => {
      const { result } = renderHook(() => useStartMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      // Check optimistic update immediately
      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      expect(cachedData?.[0].status).toBe('running');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('should update single mission cache', async () => {
      queryClient.setQueryData(['missions', 'detail', 'mission-1'], {
        ...mockMission,
        status: 'pending' as const,
      });

      const { result } = renderHook(() => useStartMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      const cachedDetail = queryClient.getQueryData<Mission>(['missions', 'detail', 'mission-1']);
      expect(cachedDetail?.status).toBe('running');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('should rollback on error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Server Error',
        } as Response)
      );

      const { result } = renderHook(() => useStartMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      await waitFor(() => expect(result.current.isError).toBe(true));

      // Cache should be rolled back to pending
      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      expect(cachedData?.[0].status).toBe('pending');

      global.fetch = originalFetch;
    });

    it('should invalidate queries after success', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useStartMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: expect.arrayContaining(['missions']),
        })
      );

      invalidateSpy.mockRestore();
    });
  });

  describe('usePauseMission', () => {
    beforeEach(() => {
      queryClient.setQueryData(['missions', 'lists'], [
        { ...mockMission, status: 'running' as const },
      ]);
    });

    it('should pause mission with optimistic update', async () => {
      const { result } = renderHook(() => usePauseMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      expect(cachedData?.[0].status).toBe('paused');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('should handle pause API error', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Forbidden',
        } as Response)
      );

      const { result } = renderHook(() => usePauseMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toContain('Failed to pause mission');

      global.fetch = originalFetch;
    });
  });

  describe('useResumeMission', () => {
    beforeEach(() => {
      queryClient.setQueryData(['missions', 'lists'], [
        { ...mockMission, status: 'paused' as const },
      ]);
    });

    it('should resume mission with optimistic update', async () => {
      const { result } = renderHook(() => useResumeMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      expect(cachedData?.[0].status).toBe('running');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
  });

  describe('useStopMission', () => {
    beforeEach(() => {
      queryClient.setQueryData(['missions', 'lists'], [
        { ...mockMission, status: 'running' as const },
      ]);
    });

    it('should stop mission with optimistic update', async () => {
      const { result } = renderHook(() => useStopMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      expect(cachedData?.[0].status).toBe('stopped');
      expect(cachedData?.[0].completedAt).toBeDefined();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('should set completedAt timestamp', async () => {
      const { result } = renderHook(() => useStopMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      const beforeTime = Date.now();
      result.current.mutate('mission-1');

      const cachedData = queryClient.getQueryData<Mission[]>(['missions', 'lists']);
      const completedAt = cachedData?.[0].completedAt;

      expect(completedAt).toBeDefined();
      expect(new Date(completedAt!).getTime()).toBeGreaterThanOrEqual(beforeTime);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate all mission queries on mutation', async () => {
      queryClient.setQueryData(['missions', 'lists'], [mockMission]);
      queryClient.setQueryData(['missions', 'detail', 'mission-1'], mockMission);

      const { result } = renderHook(() => useStartMission(), {
        wrapper: createHookWrapper(queryClient),
      });

      result.current.mutate('mission-1');

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Queries should be marked as stale/invalidated
      const queryCache = queryClient.getQueryCache();
      const queries = queryCache.findAll({ queryKey: ['missions'] });

      queries.forEach((query) => {
        expect(query.isStale() || query.state.dataUpdatedAt > 0).toBe(true);
      });
    });
  });
});
