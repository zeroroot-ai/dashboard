import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Tenant } from '@/src/types/tenant';

// Mock localStorage for persistence testing
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Import after mocking localStorage
import {
  useTenantStore,
  useCurrentTenant,
  useAvailableTenants,
  useTenantLoading,
  useTenantError,
  useSwitcherOpen,
  useTenantActions,
  useCanSwitchToTenant,
} from './tenant-store';

// Mock tenant data
const mockTenant1: Tenant = {
  id: 'tenant-1',
  name: 'acme-corp',
  displayName: 'Acme Corporation',
  description: 'Main corporate tenant',
  color: '#3B82F6',
  icon: 'Building2',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockTenant2: Tenant = {
  id: 'tenant-2',
  name: 'beta-labs',
  displayName: 'Beta Labs',
  description: 'Research division',
  color: '#10B981',
  icon: 'FlaskConical',
  createdAt: new Date('2024-01-15'),
  updatedAt: new Date('2024-01-15'),
};

const mockTenant3: Tenant = {
  id: 'tenant-3',
  name: 'gamma-tech',
  displayName: 'Gamma Tech',
  description: 'Technology division',
  color: '#F59E0B',
  icon: 'Cpu',
  createdAt: new Date('2024-02-01'),
  updatedAt: new Date('2024-02-01'),
};

describe('useTenantStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useTenantStore.getState().reset();
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should have correct default values', () => {
      const state = useTenantStore.getState();

      expect(state.currentTenant).toBeNull();
      expect(state.availableTenants).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.switcherOpen).toBe(false);
      expect(state.lastSwitchTimestamp).toBeNull();
    });
  });

  describe('setCurrentTenant', () => {
    it('should update current tenant correctly', () => {
      const { setCurrentTenant } = useTenantStore.getState();

      act(() => {
        setCurrentTenant(mockTenant1);
      });

      const state = useTenantStore.getState();
      expect(state.currentTenant).toEqual(mockTenant1);
      expect(state.error).toBeNull();
    });

    it('should clear error when setting tenant', () => {
      const { setCurrentTenant, setError } = useTenantStore.getState();

      act(() => {
        setError('Previous error');
        setCurrentTenant(mockTenant1);
      });

      expect(useTenantStore.getState().error).toBeNull();
    });

    it('should allow setting tenant to null', () => {
      const { setCurrentTenant } = useTenantStore.getState();

      act(() => {
        setCurrentTenant(mockTenant1);
        setCurrentTenant(null);
      });

      expect(useTenantStore.getState().currentTenant).toBeNull();
    });
  });

  describe('setAvailableTenants', () => {
    it('should update available tenants list', () => {
      const { setAvailableTenants } = useTenantStore.getState();
      const tenants = [mockTenant1, mockTenant2, mockTenant3];

      act(() => {
        setAvailableTenants(tenants);
      });

      expect(useTenantStore.getState().availableTenants).toEqual(tenants);
    });

    it('should allow empty tenant list', () => {
      const { setAvailableTenants } = useTenantStore.getState();

      act(() => {
        setAvailableTenants([mockTenant1]);
        setAvailableTenants([]);
      });

      expect(useTenantStore.getState().availableTenants).toEqual([]);
    });
  });

  describe('switchTenant', () => {
    it('should successfully switch to a valid tenant', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();
      const mockApiCall = vi.fn().mockResolvedValue(mockTenant2);

      act(() => {
        setAvailableTenants([mockTenant1, mockTenant2, mockTenant3]);
        setCurrentTenant(mockTenant1);
      });

      await act(async () => {
        await switchTenant('tenant-2', mockApiCall);
      });

      const state = useTenantStore.getState();
      expect(state.currentTenant).toEqual(mockTenant2);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.switcherOpen).toBe(false);
      expect(state.lastSwitchTimestamp).not.toBeNull();
      expect(mockApiCall).toHaveBeenCalledWith('tenant-2');
    });

    it('should apply optimistic update immediately', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();

      // Create a promise that we can resolve manually
      let resolveApiCall: (value: Tenant) => void;
      const mockApiCall = vi.fn().mockImplementation(
        () =>
          new Promise<Tenant>((resolve) => {
            resolveApiCall = resolve;
          })
      );

      act(() => {
        setAvailableTenants([mockTenant1, mockTenant2]);
        setCurrentTenant(mockTenant1);
      });

      // Start the switch but don't wait for it
      let switchPromise: Promise<void>;
      act(() => {
        switchPromise = switchTenant('tenant-2', mockApiCall);
      });

      // Check optimistic update was applied
      expect(useTenantStore.getState().currentTenant?.id).toBe('tenant-2');
      expect(useTenantStore.getState().isLoading).toBe(true);
      expect(useTenantStore.getState().switcherOpen).toBe(false);

      // Resolve the API call
      await act(async () => {
        resolveApiCall!(mockTenant2);
        await switchPromise;
      });

      // Check final state
      expect(useTenantStore.getState().isLoading).toBe(false);
    });

    it('should rollback on API error', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();
      const mockApiCall = vi.fn().mockRejectedValue(new Error('API Error'));

      act(() => {
        setAvailableTenants([mockTenant1, mockTenant2]);
        setCurrentTenant(mockTenant1);
      });

      await act(async () => {
        try {
          await switchTenant('tenant-2', mockApiCall);
        } catch {
          // Expected to throw
        }
      });

      const state = useTenantStore.getState();
      // Should rollback to previous tenant
      expect(state.currentTenant).toEqual(mockTenant1);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('API Error');
    });

    it('should throw error when target tenant not in available list', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();
      const mockApiCall = vi.fn();

      act(() => {
        setAvailableTenants([mockTenant1]);
        setCurrentTenant(mockTenant1);
      });

      await expect(
        act(async () => {
          await switchTenant('non-existent-tenant', mockApiCall);
        })
      ).rejects.toThrow('Tenant not found in your accessible tenants');

      expect(mockApiCall).not.toHaveBeenCalled();
      expect(useTenantStore.getState().error).toBe(
        'Tenant not found in your accessible tenants'
      );
    });

    it('should handle non-Error exception types', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();
      const mockApiCall = vi.fn().mockRejectedValue('String error');

      act(() => {
        setAvailableTenants([mockTenant1, mockTenant2]);
        setCurrentTenant(mockTenant1);
      });

      await act(async () => {
        try {
          await switchTenant('tenant-2', mockApiCall);
        } catch {
          // Expected
        }
      });

      expect(useTenantStore.getState().error).toBe('Failed to switch tenant');
    });
  });

  describe('setSwitcherOpen', () => {
    it('should toggle switcher open state', () => {
      const { setSwitcherOpen } = useTenantStore.getState();

      expect(useTenantStore.getState().switcherOpen).toBe(false);

      act(() => {
        setSwitcherOpen(true);
      });
      expect(useTenantStore.getState().switcherOpen).toBe(true);

      act(() => {
        setSwitcherOpen(false);
      });
      expect(useTenantStore.getState().switcherOpen).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('should update loading state', () => {
      const { setLoading } = useTenantStore.getState();

      act(() => {
        setLoading(true);
      });
      expect(useTenantStore.getState().isLoading).toBe(true);

      act(() => {
        setLoading(false);
      });
      expect(useTenantStore.getState().isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('should update error state', () => {
      const { setError } = useTenantStore.getState();

      act(() => {
        setError('Test error message');
      });
      expect(useTenantStore.getState().error).toBe('Test error message');

      act(() => {
        setError(null);
      });
      expect(useTenantStore.getState().error).toBeNull();
    });
  });

  describe('reset', () => {
    it('should reset all state to initial values', () => {
      const { setCurrentTenant, setAvailableTenants, setLoading, setError, setSwitcherOpen, reset } =
        useTenantStore.getState();

      // Set various states
      act(() => {
        setCurrentTenant(mockTenant1);
        setAvailableTenants([mockTenant1, mockTenant2]);
        setLoading(true);
        setError('Some error');
        setSwitcherOpen(true);
      });

      // Reset
      act(() => {
        reset();
      });

      const state = useTenantStore.getState();
      expect(state.currentTenant).toBeNull();
      expect(state.availableTenants).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.switcherOpen).toBe(false);
      expect(state.lastSwitchTimestamp).toBeNull();
    });
  });

  describe('localStorage Persistence', () => {
    it('should persist currentTenant to localStorage', async () => {
      const { setCurrentTenant } = useTenantStore.getState();

      act(() => {
        setCurrentTenant(mockTenant1);
      });

      // Wait for persistence middleware
      await waitFor(() => {
        expect(localStorageMock.setItem).toHaveBeenCalled();
      });

      const lastCall = localStorageMock.setItem.mock.calls.find(
        (call) => call[0] === 'gibson-tenant-store'
      );
      expect(lastCall).toBeDefined();

      if (lastCall) {
        const persisted = JSON.parse(lastCall[1]);
        expect(persisted.state.currentTenant.id).toBe('tenant-1');
      }
    });

    it('should persist lastSwitchTimestamp to localStorage', async () => {
      const { setAvailableTenants, setCurrentTenant, switchTenant } =
        useTenantStore.getState();
      const mockApiCall = vi.fn().mockResolvedValue(mockTenant2);

      act(() => {
        setAvailableTenants([mockTenant1, mockTenant2]);
        setCurrentTenant(mockTenant1);
      });

      await act(async () => {
        await switchTenant('tenant-2', mockApiCall);
      });

      await waitFor(() => {
        const calls = localStorageMock.setItem.mock.calls.filter(
          (call) => call[0] === 'gibson-tenant-store'
        );
        const lastCall = calls[calls.length - 1];
        if (lastCall) {
          const persisted = JSON.parse(lastCall[1]);
          expect(persisted.state.lastSwitchTimestamp).not.toBeNull();
        }
      });
    });

    it('should NOT persist loading or error states', async () => {
      const { setLoading, setError } = useTenantStore.getState();

      act(() => {
        setLoading(true);
        setError('Test error');
      });

      await waitFor(() => {
        const calls = localStorageMock.setItem.mock.calls.filter(
          (call) => call[0] === 'gibson-tenant-store'
        );
        if (calls.length > 0) {
          const lastCall = calls[calls.length - 1];
          const persisted = JSON.parse(lastCall[1]);
          // These should not be in persisted state
          expect(persisted.state.isLoading).toBeUndefined();
          expect(persisted.state.error).toBeUndefined();
        }
      });
    });
  });
});

describe('Selector Hooks', () => {
  beforeEach(() => {
    useTenantStore.getState().reset();
  });

  describe('useCurrentTenant', () => {
    it('should return current tenant', () => {
      act(() => {
        useTenantStore.getState().setCurrentTenant(mockTenant1);
      });

      const { result } = renderHook(() => useCurrentTenant());
      expect(result.current).toEqual(mockTenant1);
    });

    it('should update when tenant changes', () => {
      const { result } = renderHook(() => useCurrentTenant());

      expect(result.current).toBeNull();

      act(() => {
        useTenantStore.getState().setCurrentTenant(mockTenant1);
      });

      expect(result.current).toEqual(mockTenant1);
    });
  });

  describe('useAvailableTenants', () => {
    it('should return available tenants list', () => {
      act(() => {
        useTenantStore.getState().setAvailableTenants([mockTenant1, mockTenant2]);
      });

      const { result } = renderHook(() => useAvailableTenants());
      expect(result.current).toHaveLength(2);
      expect(result.current[0]).toEqual(mockTenant1);
    });
  });

  describe('useTenantLoading', () => {
    it('should return loading state', () => {
      const { result } = renderHook(() => useTenantLoading());
      expect(result.current).toBe(false);

      act(() => {
        useTenantStore.getState().setLoading(true);
      });

      expect(result.current).toBe(true);
    });
  });

  describe('useTenantError', () => {
    it('should return error state', () => {
      const { result } = renderHook(() => useTenantError());
      expect(result.current).toBeNull();

      act(() => {
        useTenantStore.getState().setError('Test error');
      });

      expect(result.current).toBe('Test error');
    });
  });

  describe('useSwitcherOpen', () => {
    it('should return switcher open state', () => {
      const { result } = renderHook(() => useSwitcherOpen());
      expect(result.current).toBe(false);

      act(() => {
        useTenantStore.getState().setSwitcherOpen(true);
      });

      expect(result.current).toBe(true);
    });
  });

  describe('useTenantActions', () => {
    it('should return all action functions', () => {
      const { result } = renderHook(() => useTenantActions());

      expect(typeof result.current.setCurrentTenant).toBe('function');
      expect(typeof result.current.setAvailableTenants).toBe('function');
      expect(typeof result.current.switchTenant).toBe('function');
      expect(typeof result.current.setSwitcherOpen).toBe('function');
      expect(typeof result.current.setLoading).toBe('function');
      expect(typeof result.current.setError).toBe('function');
      expect(typeof result.current.reset).toBe('function');
    });
  });

  describe('useCanSwitchToTenant', () => {
    it('should return true for valid switchable tenant', () => {
      act(() => {
        useTenantStore.getState().setAvailableTenants([mockTenant1, mockTenant2]);
        useTenantStore.getState().setCurrentTenant(mockTenant1);
      });

      const { result } = renderHook(() => useCanSwitchToTenant('tenant-2'));
      expect(result.current).toBe(true);
    });

    it('should return false for current tenant', () => {
      act(() => {
        useTenantStore.getState().setAvailableTenants([mockTenant1, mockTenant2]);
        useTenantStore.getState().setCurrentTenant(mockTenant1);
      });

      const { result } = renderHook(() => useCanSwitchToTenant('tenant-1'));
      expect(result.current).toBe(false);
    });

    it('should return false for tenant not in available list', () => {
      act(() => {
        useTenantStore.getState().setAvailableTenants([mockTenant1]);
        useTenantStore.getState().setCurrentTenant(mockTenant1);
      });

      const { result } = renderHook(() => useCanSwitchToTenant('tenant-2'));
      expect(result.current).toBe(false);
    });
  });
});
