import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useFindings,
  useInfiniteFindings,
  useFinding,
  useFindingsCounts,
  useFindingsSSE,
} from './useFindings';
import { createTestQueryClient, createHookWrapper, TEST_TENANT } from '@/src/test/test-utils';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/src/lib/query/keys';
import type { Finding, PaginatedResponse } from '@/src/types';

const mockFinding: Finding = {
  id: 'finding-1',
  missionId: 'mission-1',
  type: 'vulnerability',
  severity: 'high',
  title: 'SQL Injection',
  description: 'A SQL injection vulnerability was found',
  affectedAssets: ['web-app-1'],
  discoveredAt: new Date('2024-03-01T10:00:00Z'),
  taxonomy: {
    framework: 'OWASP',
    category: 'Injection',
  },
};

describe('useFindings', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('useFindings (list)', () => {
    it('should fetch findings successfully', async () => {
      const { result } = renderHook(() => useFindings(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.data).toBeDefined();
      expect(Array.isArray(result.current.data?.data)).toBe(true);
    });

    it('should apply filters to query', async () => {
      const filters = {
        severity: ['critical' as const, 'high' as const],
        search: 'injection',
      };

      const { result } = renderHook(() => useFindings(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      // MSW handler should filter findings by severity
    });

    it('should apply pagination options', async () => {
      const { result } = renderHook(() => useFindings({}, { limit: 10 }), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data.length).toBeLessThanOrEqual(10);
    });

    it('should handle error state', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Internal Server Error',
        } as Response)
      );

      const { result } = renderHook(() => useFindings(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect(result.current.error?.message).toContain('Failed to fetch findings');

      global.fetch = originalFetch;
    });
  });

  describe('useInfiniteFindings', () => {
    it('should fetch findings with infinite scroll', async () => {
      const { result } = renderHook(() => useInfiniteFindings(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.pages).toBeDefined();
      expect(result.current.data?.pages.length).toBeGreaterThan(0);
    });

    it('should fetch next page when hasNextPage is true', async () => {
      const { result } = renderHook(() => useInfiniteFindings({}, 10), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      if (result.current.hasNextPage) {
        await act(async () => {
          await result.current.fetchNextPage();
        });

        await waitFor(() => {
          expect(result.current.data?.pages.length).toBeGreaterThan(1);
        });
      }
    });

    it('should apply filters to infinite query', async () => {
      const filters = { severity: ['critical' as const] };

      const { result } = renderHook(() => useInfiniteFindings(filters), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.pages[0].data).toBeDefined();
    });
  });

  describe('useFinding (single)', () => {
    it('should fetch single finding successfully', async () => {
      const { result } = renderHook(() => useFinding('finding-1'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.id).toBe('finding-1');
    });

    it('should not fetch when id is null', () => {
      const { result } = renderHook(() => useFinding(null), {
        wrapper: createHookWrapper(queryClient),
      });

      expect(result.current.isPending).toBe(true);
      expect(result.current.fetchStatus).toBe('idle');
    });

    it('should handle error for nonexistent finding', async () => {
      const originalFetch = global.fetch;
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          statusText: 'Not Found',
        } as Response)
      );

      const { result } = renderHook(() => useFinding('nonexistent'), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      global.fetch = originalFetch;
    });
  });

  describe('useFindingsCounts', () => {
    it('should fetch severity counts successfully', async () => {
      const { result } = renderHook(() => useFindingsCounts(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data).toHaveProperty('critical');
      expect(result.current.data).toHaveProperty('high');
      expect(result.current.data).toHaveProperty('medium');
      expect(result.current.data).toHaveProperty('low');
      expect(result.current.data).toHaveProperty('info');
    });

    it('should auto-refetch every 30 seconds', async () => {
      // shouldAdvanceTime keeps testing-library's waitFor polling alive under
      // fake timers, without it, the microtask + setTimeout queue is paused
      // and waitFor's interval never re-fires.
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const { result } = renderHook(() => useFindingsCounts(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      const initialDataUpdatedAt = result.current.dataUpdatedAt;

      vi.advanceTimersByTime(30000);

      await waitFor(() => {
        expect(result.current.dataUpdatedAt).toBeGreaterThan(initialDataUpdatedAt);
      });

      vi.restoreAllMocks();
    });
  });

  describe('useFindingsSSE', () => {
    let eventSourceMock: {
      onopen?: () => void;
      onmessage?: (event: MessageEvent) => void;
      onerror?: (error: Event) => void;
      close: ReturnType<typeof vi.fn>;
      readyState: number;
    };

    beforeEach(() => {
      eventSourceMock = {
        onopen: undefined,
        onmessage: undefined,
        onerror: undefined,
        close: vi.fn(),
        readyState: 1, // OPEN
      };

      // Mock EventSource. Must be a function expression, NOT an arrow function -
      // arrows are not constructable, so `new EventSource(...)` would throw
      // "is not a constructor" and the hook's try/catch would silently swallow
      // it. Returning a non-primitive from a constructor makes `new` resolve
      // to that value, so `new EventSource()` evaluates to `eventSourceMock`.
      global.EventSource = vi.fn(function () { return eventSourceMock; }) as unknown as typeof EventSource;
    });

    afterEach(() => {
      vi.restoreAllMocks();
      // Some tests in this describe call vi.useFakeTimers(), restore real
      // timers so later describes / tests don't inherit fake-timer state.
      vi.useRealTimers();
    });

    it('should connect to SSE stream on mount', async () => {
      renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(global.EventSource).toHaveBeenCalledWith(
          expect.stringContaining('/api/findings/stream')
        );
      });
    });

    it('should add new finding to cache on SSE message', async () => {
      // Hook writes into the queryKeys.findings.list(tenantId, filters) cache
      // key, must pre-populate with the same key, not a hand-rolled
      // ['findings', 'list'] shorthand.
      const cacheKey = queryKeys.findings.list(TEST_TENANT.id, {});
      queryClient.setQueryData(cacheKey, {
        data: [],
        total: 0,
        nextCursor: null,
      } as unknown as PaginatedResponse<Finding>);

      renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      // Simulate SSE message
      const newFinding = { ...mockFinding, id: 'finding-new' };
      const event = new MessageEvent('message', {
        data: JSON.stringify(newFinding),
      });

      act(() => {
        eventSourceMock.onmessage!(event);
      });

      await waitFor(() => {
        const cachedData = queryClient.getQueryData<PaginatedResponse<Finding>>(cacheKey);
        expect(cachedData?.data[0]?.id).toBe('finding-new');
      });
    });

    it('should call onNewFinding callback when provided', async () => {
      const onNewFinding = vi.fn();

      queryClient.setQueryData(['findings', 'list'], {
        data: [],
        total: 0,
        nextCursor: null,
      } as unknown as PaginatedResponse<Finding>);

      renderHook(() => useFindingsSSE({}, onNewFinding), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const newFinding = { ...mockFinding, id: 'finding-new' };
      const event = new MessageEvent('message', {
        data: JSON.stringify(newFinding),
      });

      act(() => {
        eventSourceMock.onmessage!(event);
      });

      await waitFor(() => {
        expect(onNewFinding).toHaveBeenCalledWith(expect.objectContaining({ id: 'finding-new' }));
      });
    });

    it('should invalidate counts query on new finding', async () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      queryClient.setQueryData(['findings', 'list'], {
        data: [],
        total: 0,
        nextCursor: null,
      } as unknown as PaginatedResponse<Finding>);

      renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      const event = new MessageEvent('message', {
        data: JSON.stringify(mockFinding),
      });

      act(() => {
        eventSourceMock.onmessage!(event);
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            queryKey: expect.arrayContaining(['findings', 'counts']),
          })
        );
      });

      invalidateSpy.mockRestore();
    });

    it('should handle parse errors gracefully', async () => {
      queryClient.setQueryData(['findings', 'list'], {
        data: [],
        total: 0,
        nextCursor: null,
      } as unknown as PaginatedResponse<Finding>);

      renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onmessage).toBeDefined();
      });

      // Send invalid JSON. The hook's onmessage uses `catch {}` to silently
      // discard unparseable frames (useFindings.ts:60), no log emitted, no
      // disconnect. The observable contract is "do not crash, do not close
      // the connection".
      const event = new MessageEvent('message', {
        data: 'invalid json',
      });

      act(() => {
        eventSourceMock.onmessage!(event);
      });

      expect(eventSourceMock.close).not.toHaveBeenCalled();
    });

    it('should reconnect on error with exponential backoff', async () => {
      // shouldAdvanceTime keeps testing-library's waitFor polling alive under
      // fake timers, without it, the microtask + setTimeout queue is paused
      // and waitFor's interval never re-fires.
      vi.useFakeTimers({ shouldAdvanceTime: true });

      renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onerror).toBeDefined();
      });

      // Trigger error
      act(() => {
        eventSourceMock.onerror!(new Event('error'));
      });

      expect(eventSourceMock.close).toHaveBeenCalled();

      // First reconnect after 1 second
      vi.advanceTimersByTime(1000);

      await waitFor(() => {
        expect(global.EventSource).toHaveBeenCalledTimes(2);
      });

      vi.restoreAllMocks();
    });

    it('should close connection on unmount', async () => {
      const { unmount } = renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock).toBeDefined();
      });

      unmount();

      expect(eventSourceMock.close).toHaveBeenCalled();
    });

    it('should provide disconnect function', async () => {
      const { result } = renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(result.current.disconnect).toBeDefined();
      });

      act(() => {
        result.current.disconnect();
      });

      expect(eventSourceMock.close).toHaveBeenCalled();
    });

    it('should indicate connection status', async () => {
      const { result } = renderHook(() => useFindingsSSE(), {
        wrapper: createHookWrapper(queryClient),
      });

      await waitFor(() => {
        expect(eventSourceMock.onopen).toBeDefined();
      });

      // Simulate connection open
      act(() => {
        eventSourceMock.onopen!();
      });

      expect(result.current.isConnected).toBe(true);
    });
  });
});
