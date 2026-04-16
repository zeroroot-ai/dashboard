"use client";

/**
 * Tenant Context Provider
 * React Context provider that wraps the Zustand store and provides tenant state
 * throughout the component tree with server-side hydration support
 */

import {
  createContext,
  useContext,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useTenantStore,
  useCurrentTenant,
  useAvailableTenants,
  useTenantLoading,
  useTenantError,
} from "@/src/stores/tenant-store";
import type { Tenant } from "@/src/types/tenant";

// ============================================================================
// Context Types
// ============================================================================

export interface TenantContextValue {
  /** Currently selected tenant */
  currentTenant: Tenant | null;
  /** All tenants the user has access to */
  availableTenants: Tenant[];
  /** Whether tenant data is loading */
  isLoading: boolean;
  /** Error message if any */
  error: string | null;
  /** Switch to a different tenant */
  switchTenant: (tenantId: string) => Promise<void>;
  /** Refresh the list of available tenants */
  refetchTenants: () => Promise<void>;
  /** Check if user can switch to a specific tenant */
  canSwitchTenant: (tenantId: string) => boolean;
}

export interface TenantProviderProps {
  children: ReactNode;
  /** Initial tenant from server-side session */
  initialTenant?: Tenant | null;
  /** Initial list of available tenants from server-side session */
  initialTenants?: Tenant[];
}

// ============================================================================
// Context
// ============================================================================

const TenantContext = createContext<TenantContextValue | null>(null);

// ============================================================================
// Provider Component
// ============================================================================

export function TenantContextProvider({
  children,
  initialTenant = null,
  initialTenants = [],
}: TenantProviderProps) {
  const queryClient = useQueryClient();

  // Get state from Zustand store
  const currentTenant = useCurrentTenant();
  const availableTenants = useAvailableTenants();
  const isLoading = useTenantLoading();
  const error = useTenantError();

  // Get store actions
  const store = useTenantStore();

  // Hydrate store with initial values from server on mount
  useEffect(() => {
    // Only hydrate if store is empty (not already hydrated from localStorage)
    if (!currentTenant && initialTenant) {
      store.setCurrentTenant(initialTenant);
    }

    if (availableTenants.length === 0 && initialTenants.length > 0) {
      store.setAvailableTenants(initialTenants);
    }
  }, [
    currentTenant,
    initialTenant,
    availableTenants.length,
    initialTenants,
    store,
  ]);

  // Switch tenant handler with cache invalidation
  const switchTenant = useCallback(
    async (tenantId: string) => {
      const apiCall = async (id: string): Promise<Tenant> => {
        const response = await fetch("/api/tenants/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId: id }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.message || `Failed to switch tenant: ${response.status}`
          );
        }

        const data = await response.json();
        return data.tenant;
      };

      await store.switchTenant(tenantId, apiCall);

      // Invalidate all React Query caches on tenant switch
      // This ensures all data is refetched with the new tenant context
      await queryClient.invalidateQueries();
    },
    [store, queryClient]
  );

  // Refetch available tenants
  const refetchTenants = useCallback(async () => {
    store.setLoading(true);
    store.setError(null);

    try {
      const response = await fetch("/api/tenants");

      if (!response.ok) {
        throw new Error("Failed to fetch tenants");
      }

      const data = await response.json();
      store.setAvailableTenants(data.tenants);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to fetch tenants";
      store.setError(errorMessage);
      throw err;
    } finally {
      store.setLoading(false);
    }
  }, [store]);

  // Check if user can switch to a specific tenant
  const canSwitchTenant = useCallback(
    (tenantId: string): boolean => {
      // Can't switch if already on this tenant
      if (currentTenant?.id === tenantId) {
        return false;
      }

      // Can only switch to tenants in the available list
      return availableTenants.some((t) => t.id === tenantId);
    },
    [currentTenant, availableTenants]
  );

  // Context value
  const contextValue: TenantContextValue = {
    currentTenant,
    availableTenants,
    isLoading,
    error,
    switchTenant,
    refetchTenants,
    canSwitchTenant,
  };

  return (
    <TenantContext.Provider value={contextValue}>
      {children}
    </TenantContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to access tenant context.
 * Must be used within a TenantContextProvider.
 *
 * @throws Error if used outside of TenantContextProvider
 */
export function useTenantContext(): TenantContextValue {
  const context = useContext(TenantContext);

  if (!context) {
    throw new Error(
      "useTenantContext must be used within a TenantContextProvider. " +
        "Make sure your component is wrapped in <TenantContextProvider>."
    );
  }

  return context;
}

// ============================================================================
// Display Name for DevTools
// ============================================================================

TenantContext.displayName = "TenantContext";
TenantContextProvider.displayName = "TenantContextProvider";
