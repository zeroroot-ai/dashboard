import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useAvailablePlugins,
  useTenantPlugins,
  useEnablePlugin,
  useDisablePlugin,
  useUpdatePluginConfig,
  useTestConnection,
  useUpdatePluginAccess,
  type PluginCatalogEntry,
  type PluginAccess,
  type TestConnectionResult,
} from '../use-plugins';
import { queryKeys } from '@/src/lib/query/keys';

// ============================================================================
// Fixture data
// ============================================================================

const mockAvailablePlugins: PluginCatalogEntry[] = [
  {
    name: 'gitlab',
    version: '1.0.0',
    description: 'GitLab plugin',
    methods: ['listProjects'],
    configSchemaJson: '',
    enabled: false,
    configured: false,
    healthStatus: 'unknown',
    source: 'platform',
    instanceCount: 0,
  },
];

const mockTenantPlugins: PluginAccess[] = [
  {
    tenantId: 'tenant-1',
    pluginName: 'gitlab',
    enabled: true,
    readEnabled: true,
    writeEnabled: true,
    source: 'platform',
    configuredAt: '2024-01-01T00:00:00Z',
    configuredBy: 'admin@example.com',
  },
];

const mockTestResult: TestConnectionResult = {
  success: true,
  message: 'Connected successfully',
};

// ============================================================================
// Test helpers
// ============================================================================

function createWrapper(queryClient: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return Wrapper;
}

function createFreshQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function mockFetchSuccess(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
    statusText: 'OK',
  } as Response);
}

function mockFetchError(statusText = 'Internal Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    statusText,
    json: () => Promise.resolve({ error: { message: statusText } }),
  } as Response);
}

// ============================================================================
// Tests
// ============================================================================

describe('useAvailablePlugins', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ plugins: mockAvailablePlugins });
  });

  it('returns available plugins data', async () => {
    const { result } = renderHook(() => useAvailablePlugins('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockAvailablePlugins);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('type=available')
    );
  });

  it('is disabled when tenantId is empty', () => {
    const { result } = renderHook(() => useAvailablePlugins(''), {
      wrapper: createWrapper(queryClient),
    });
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('returns error state on fetch failure', async () => {
    global.fetch = mockFetchError();
    const { result } = renderHook(() => useAvailablePlugins('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useTenantPlugins', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ plugins: mockTenantPlugins });
  });

  it('returns tenant plugins data', async () => {
    const { result } = renderHook(() => useTenantPlugins('tenant-1'), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(mockTenantPlugins);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('type=tenant')
    );
  });
});

describe('useEnablePlugin', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ success: true });
    queryClient.setQueryData(queryKeys.plugins.available('tenant-1'), mockAvailablePlugins);
    queryClient.setQueryData(queryKeys.plugins.tenant('tenant-1'), mockTenantPlugins);
  });

  it('calls POST /api/plugins/[name] with correct payload', async () => {
    const { result } = renderHook(() => useEnablePlugin(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: { token: 'my-token' },
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/plugins/gitlab',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tenantId: 'tenant-1', config: { token: 'my-token' } }),
      })
    );
  });

  it('invalidates available and tenant plugin queries on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useEnablePlugin(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: {},
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.available('tenant-1') })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.tenant('tenant-1') })
    );
  });
});

describe('useDisablePlugin', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ success: true });
  });

  it('calls DELETE /api/plugins/[name] with correct payload', async () => {
    const { result } = renderHook(() => useDisablePlugin(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ tenantId: 'tenant-1', pluginName: 'gitlab' });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/plugins/gitlab',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ tenantId: 'tenant-1' }),
      })
    );
  });

  it('invalidates both list queries on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDisablePlugin(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ tenantId: 'tenant-1', pluginName: 'gitlab' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.available('tenant-1') })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.tenant('tenant-1') })
    );
  });
});

describe('useUpdatePluginConfig', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ success: true });
  });

  it('calls PATCH /api/plugins/[name] with correct payload', async () => {
    const { result } = renderHook(() => useUpdatePluginConfig(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: { token: 'new-token' },
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/plugins/gitlab',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ tenantId: 'tenant-1', config: { token: 'new-token' } }),
      })
    );
  });

  it('invalidates tenant and config queries on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePluginConfig(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: {},
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.tenant('tenant-1') })
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.config('tenant-1', 'gitlab') })
    );
  });
});

describe('useTestConnection', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess(mockTestResult);
  });

  it('calls POST /api/plugins/[name]/test and returns result', async () => {
    const { result } = renderHook(() => useTestConnection(), {
      wrapper: createWrapper(queryClient),
    });

    let mutationResult: TestConnectionResult | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: { token: 'test-token' },
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/plugins/gitlab/test',
      expect.objectContaining({ method: 'POST' })
    );
    expect(mutationResult).toEqual(mockTestResult);
  });

  it('does not invalidate any queries on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTestConnection(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        config: {},
      });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useUpdatePluginAccess', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createFreshQueryClient();
    global.fetch = mockFetchSuccess({ success: true });
  });

  it('calls PUT /api/plugins/access with correct payload', async () => {
    const { result } = renderHook(() => useUpdatePluginAccess(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        readEnabled: true,
        writeEnabled: false,
      });
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/plugins/access',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          tenantId: 'tenant-1',
          pluginName: 'gitlab',
          readEnabled: true,
          writeEnabled: false,
        }),
      })
    );
  });

  it('invalidates the tenant plugin list on success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePluginAccess(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        tenantId: 'tenant-1',
        pluginName: 'gitlab',
        readEnabled: false,
        writeEnabled: false,
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: queryKeys.plugins.tenant('tenant-1') })
    );
  });

  it('throws when the server returns an error', async () => {
    global.fetch = mockFetchError('Forbidden');

    const { result } = renderHook(() => useUpdatePluginAccess(), {
      wrapper: createWrapper(queryClient),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({
          tenantId: 'tenant-1',
          pluginName: 'gitlab',
          readEnabled: true,
          writeEnabled: true,
        });
      })
    ).rejects.toThrow('Forbidden');
  });
});
