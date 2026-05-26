import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useProviders,
  useEnabledProviders,
  useDefaultProvider,
  useProvider,
  useProvidersHealth,
  useProviderHealth,
  useProviderAuditLog,
  useProvidersByType,
  useAnyProviderUnhealthy,
  useProviderHealthCounts,
  providerQueryKeys,
} from '../useProviders';
import { createTestQueryClient } from '@/src/test/test-utils';
import type { ProviderConfig, HealthStatus, ListProvidersResponse } from '@/src/types/provider';

// Mock data
const mockHealthStatus: HealthStatus = {
  status: 'healthy',
  lastCheckAt: '2024-03-01T10:00:00Z',
  lastSuccessAt: '2024-03-01T10:00:00Z',
  latencyMs: 150,
  consecutiveFailures: 0,
  availableModels: ['claude-3-5-sonnet-20241022'],
};

const mockProvider: ProviderConfig = {
  name: 'anthropic-primary',
  displayName: 'Anthropic (Primary)',
  type: 'anthropic',
  apiKeyMasked: 'sk-ant****xxx',
  baseUrl: undefined,
  defaultModel: 'claude-3-5-sonnet-20241022',
  isDefault: true,
  isEnabled: true,
  health: mockHealthStatus,
  version: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-03-01T00:00:00Z',
  createdBy: 'admin@example.com',
  updatedBy: 'admin@example.com',
};

const mockOpenAIProvider: ProviderConfig = {
  ...mockProvider,
  name: 'openai-backup',
  displayName: 'OpenAI (Backup)',
  type: 'openai',
  isDefault: false,
  health: { ...mockHealthStatus, status: 'degraded' },
};

const mockProvidersResponse: ListProvidersResponse = {
  providers: [mockProvider, mockOpenAIProvider],
  defaultProvider: 'anthropic-primary',
};

describe('useProviders Hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    vi.resetAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('providerQueryKeys', () => {
    it('should generate correct query keys', () => {
      expect(providerQueryKeys.all).toEqual(['providers']);
      expect(providerQueryKeys.lists()).toEqual(['providers', 'list']);
      expect(providerQueryKeys.list({ includeDisabled: true })).toEqual([
        'providers',
        'list',
        { includeDisabled: true },
      ]);
      expect(providerQueryKeys.detail('test')).toEqual(['providers', 'detail', 'test']);
      expect(providerQueryKeys.health()).toEqual(['providers', 'health']);
      expect(providerQueryKeys.audit()).toEqual(['providers', 'audit']);
    });
  });

  describe('useProviders', () => {
    it('should fetch providers successfully', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvidersResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProviders(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeDefined();
      expect(result.current.data?.providers).toHaveLength(2);
      expect(result.current.data?.defaultProvider).toBe('anthropic-primary');
    });

    it('should pass options to query', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvidersResponse),
        } as Response)
      );

      const { result } = renderHook(
        () => useProviders({ includeDisabled: true, includeHealth: true }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // apiFetch invokes fetch(url, init) where init is undefined for GET.
      // toHaveBeenCalledWith does strict arg-length matching, so pass undefined
      // as the second arg too. Avoids "expected 1 arg, got 2".
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('includeDisabled=true'),
        undefined
      );
    });

    it('should handle error state', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Server error' }),
        } as Response)
      );

      const { result } = renderHook(() => useProviders(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
    });
  });

  describe('useEnabledProviders', () => {
    it('should return only provider configs array', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvidersResponse),
        } as Response)
      );

      const { result } = renderHook(() => useEnabledProviders(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(mockProvidersResponse.providers);
    });
  });

  describe('useDefaultProvider', () => {
    it('should return the default provider', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvidersResponse),
        } as Response)
      );

      const { result } = renderHook(() => useDefaultProvider(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.name).toBe('anthropic-primary');
      expect(result.current.data?.isDefault).toBe(true);
    });

    it('should return undefined if no default provider', async () => {
      const responseWithNoDefault = {
        ...mockProvidersResponse,
        providers: mockProvidersResponse.providers.map((p) => ({ ...p, isDefault: false })),
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(responseWithNoDefault),
        } as Response)
      );

      const { result } = renderHook(() => useDefaultProvider(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeUndefined();
    });
  });

  describe('useProvider', () => {
    it('should fetch a single provider by name', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvider),
        } as Response)
      );

      const { result } = renderHook(() => useProvider('anthropic-primary'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.name).toBe('anthropic-primary');
    });

    it('should be disabled when name is empty', () => {
      const { result } = renderHook(() => useProvider(''), { wrapper });

      expect(result.current.fetchStatus).toBe('idle');
    });
  });

  describe('useProvidersHealth', () => {
    it('should fetch health for all providers', async () => {
      const healthResponse = {
        statuses: {
          'anthropic-primary': mockHealthStatus,
          'openai-backup': { ...mockHealthStatus, status: 'degraded' as const },
        },
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(healthResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProvidersHealth(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.statuses['anthropic-primary']?.status).toBe('healthy');
      expect(result.current.data?.statuses['openai-backup']?.status).toBe('degraded');
    });
  });

  describe('useProviderHealth', () => {
    it('should return health for a specific provider', async () => {
      const healthResponse = {
        statuses: {
          'anthropic-primary': mockHealthStatus,
        },
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(healthResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProviderHealth('anthropic-primary'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.status).toBe('healthy');
    });
  });

  describe('useProviderAuditLog', () => {
    it('should fetch audit log', async () => {
      const auditResponse = {
        events: [
          {
            id: 'evt-1',
            type: 'provider_created',
            providerName: 'anthropic-primary',
            actor: 'admin@example.com',
            timestamp: '2024-03-01T10:00:00Z',
          },
        ],
        total: 1,
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(auditResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProviderAuditLog(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.events).toHaveLength(1);
      expect(result.current.data?.total).toBe(1);
    });

    it('should pass filters to query', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ events: [], total: 0 }),
        } as Response)
      );

      const filters = {
        providerName: 'anthropic-primary',
        eventTypes: ['provider_updated' as const],
        limit: 10,
      };

      renderHook(() => useProviderAuditLog(filters), { wrapper });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // See note above on includeDisabled — same arg-length contract.
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('provider=anthropic-primary'),
        undefined
      );
    });
  });

  describe('useProvidersByType', () => {
    it('should filter providers by type', async () => {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockProvidersResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProvidersByType('anthropic'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data?.[0].type).toBe('anthropic');
    });
  });

  describe('useAnyProviderUnhealthy', () => {
    it('should return true if any provider is unhealthy', async () => {
      const healthResponse = {
        statuses: {
          'anthropic-primary': { ...mockHealthStatus, status: 'healthy' as const },
          'openai-backup': { ...mockHealthStatus, status: 'unhealthy' as const },
        },
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(healthResponse),
        } as Response)
      );

      const { result } = renderHook(() => useAnyProviderUnhealthy(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(true);
    });

    it('should return false if all providers are healthy', async () => {
      const healthResponse = {
        statuses: {
          'anthropic-primary': mockHealthStatus,
          'openai-backup': mockHealthStatus,
        },
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(healthResponse),
        } as Response)
      );

      const { result } = renderHook(() => useAnyProviderUnhealthy(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBe(false);
    });
  });

  describe('useProviderHealthCounts', () => {
    it('should return health counts by status', async () => {
      const healthResponse = {
        statuses: {
          'provider-1': { ...mockHealthStatus, status: 'healthy' as const },
          'provider-2': { ...mockHealthStatus, status: 'healthy' as const },
          'provider-3': { ...mockHealthStatus, status: 'degraded' as const },
          'provider-4': { ...mockHealthStatus, status: 'unhealthy' as const },
        },
      };

      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(healthResponse),
        } as Response)
      );

      const { result } = renderHook(() => useProviderHealthCounts(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        healthy: 2,
        degraded: 1,
        unhealthy: 1,
        unknown: 0,
      });
    });
  });
});
