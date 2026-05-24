import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useListMissionDefinitions } from './useListMissionDefinitions';
import { createTestQueryClient, createHookWrapper } from '@/src/test/test-utils';
import { QueryClient } from '@tanstack/react-query';
import type { MissionDefinitionSummary } from './useListMissionDefinitions';

const mockDefinition: MissionDefinitionSummary = {
  name: 'test',
  version: '1.0.0',
  description: 'A test mission definition',
  nodeCount: 3,
  installedAt: 1716000000,
  updatedAt: 1716100000,
};

describe('useListMissionDefinitions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
  });

  afterEach(() => {
    queryClient.clear();
    vi.useRealTimers();
  });

  it('returns definitions on success', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ definitions: [mockDefinition] }),
      } as Response)
    );

    const { result } = renderHook(() => useListMissionDefinitions(), {
      wrapper: createHookWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.definitions).toHaveLength(1);
    expect(result.current.definitions[0].name).toBe('test');
    expect(result.current.definitions[0].version).toBe('1.0.0');
    expect(result.current.definitions[0].nodeCount).toBe(3);
    expect(result.current.error).toBeNull();

    global.fetch = originalFetch;
  });

  it('isLoading is true during fetch', async () => {
    let resolveJson!: (value: unknown) => void;
    const jsonPromise = new Promise((resolve) => { resolveJson = resolve; });

    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => jsonPromise,
      } as unknown as Response)
    );

    const { result } = renderHook(() => useListMissionDefinitions(), {
      wrapper: createHookWrapper(queryClient),
    });

    expect(result.current.isLoading).toBe(true);

    resolveJson({ definitions: [mockDefinition] });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    global.fetch = originalFetch;
  });

  it('error is set on fetch failure', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        statusText: 'Internal Server Error',
      } as Response)
    );

    const { result } = renderHook(() => useListMissionDefinitions(), {
      wrapper: createHookWrapper(queryClient),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeTruthy();
    });

    const err = result.current.error;
    const message = err instanceof Error ? err.message : String(err ?? '');
    expect(message).toContain('Failed to fetch mission definitions');
    expect(result.current.definitions).toHaveLength(0);

    global.fetch = originalFetch;
  });
});
