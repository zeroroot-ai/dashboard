/**
 * useProviderHealth hook tests (dashboard#283)
 *
 * Covers:
 *   - Returns the health payload from the API
 *   - Calls the correct per-provider endpoint URL
 *   - Fires a second fetch after 60 s (via vi.useFakeTimers + renderHook)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useProviderHealth } from '../useProviderHealth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProviderHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns health data for the named provider', async () => {
    const mockHealth = {
      status: 'healthy' as const,
      lastCheckAt: '2026-01-01T00:00:00Z',
    };
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ health: mockHealth }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const queryClient = makeQueryClient();
    const { result } = renderHook(
      () => useProviderHealth('my-provider'),
      { wrapper: makeWrapper(queryClient) },
    );

    // Wait for the real fetch to resolve — placeholderData starts as 'unknown'
    await waitFor(() => {
      expect(result.current.data?.status).toBe('healthy');
    });

    expect(result.current.data?.lastCheckAt).toBe('2026-01-01T00:00:00Z');
  });

  it('calls the correct per-provider health endpoint URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ health: { status: 'unknown' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;

    const queryClient = makeQueryClient();
    renderHook(
      () => useProviderHealth('my-provider'),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = String((fetchMock.mock.calls[0] as [unknown])[0]);
    expect(calledUrl).toBe('/api/settings/providers/my-provider/health');
  });

  it('URL-encodes special characters in the provider name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ health: { status: 'unknown' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    global.fetch = fetchMock;

    const queryClient = makeQueryClient();
    renderHook(
      () => useProviderHealth('my provider/v2'),
      { wrapper: makeWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const calledUrl = String((fetchMock.mock.calls[0] as [unknown])[0]);
    expect(calledUrl).toBe('/api/settings/providers/my%20provider%2Fv2/health');
  });

  it('fires a second fetch after 60 s (refetchInterval)', async () => {
    vi.useFakeTimers();

    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ health: { status: 'healthy', lastCheckAt: new Date().toISOString() } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    });

    const queryClient = makeQueryClient();

    await act(async () => {
      renderHook(
        () => useProviderHealth('my-provider'),
        { wrapper: makeWrapper(queryClient) },
      );
      await vi.runAllTimersAsync();
    });

    const countAfterMount = fetchCallCount;
    expect(countAfterMount).toBeGreaterThanOrEqual(1);

    // Advance past the 60 s refetchInterval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    expect(fetchCallCount).toBeGreaterThan(countAfterMount);
  });

  it('returns status unknown as placeholder data before the fetch resolves', () => {
    // Suspend the fetch indefinitely to observe the placeholder
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    const queryClient = makeQueryClient();
    const { result } = renderHook(
      () => useProviderHealth('my-provider'),
      { wrapper: makeWrapper(queryClient) },
    );

    // placeholderData ensures we have something to render immediately
    expect(result.current.data?.status).toBe('unknown');
  });
});
