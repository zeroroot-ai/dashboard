/**
 * Tenant Store
 * Zustand store for managing tenant context, switching, and UI state
 */

import { create } from 'zustand';
import { persist, devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { Tenant } from '@/src/types/tenant';

// ============================================================================
// Store State Interface
// ============================================================================

export interface TenantState {
  // Current state
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
  error: string | null;

  // UI state
  switcherOpen: boolean;
  lastSwitchTimestamp: number | null;

  // Actions
  setCurrentTenant: (tenant: Tenant | null) => void;
  setAvailableTenants: (tenants: Tenant[]) => void;
  switchTenant: (tenantId: string, apiCall: (tenantId: string) => Promise<Tenant>) => Promise<void>;
  setSwitcherOpen: (open: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState = {
  currentTenant: null,
  availableTenants: [],
  isLoading: false,
  error: null,
  switcherOpen: false,
  lastSwitchTimestamp: null,
};

// ============================================================================
// Store Implementation
// ============================================================================

export const useTenantStore = create<TenantState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        ...initialState,

        // Set current tenant
        setCurrentTenant: (tenant: Tenant | null) => {
          set(
            { currentTenant: tenant, error: null },
            false,
            'setCurrentTenant'
          );
        },

        // Set available tenants
        setAvailableTenants: (tenants: Tenant[]) => {
          set(
            { availableTenants: tenants },
            false,
            'setAvailableTenants'
          );
        },

        // Switch tenant with optimistic update and rollback
        switchTenant: async (tenantId: string, apiCall: (tenantId: string) => Promise<Tenant>) => {
          const { currentTenant, availableTenants } = get();

          // Find the target tenant in available tenants
          const targetTenant = availableTenants.find((t) => t.id === tenantId);

          if (!targetTenant) {
            set(
              { error: 'Tenant not found in your accessible tenants' },
              false,
              'switchTenant/error'
            );
            throw new Error('Tenant not found in your accessible tenants');
          }

          // Store previous tenant for rollback
          const previousTenant = currentTenant;

          // Optimistic update
          set(
            {
              currentTenant: targetTenant,
              isLoading: true,
              error: null,
              switcherOpen: false,
            },
            false,
            'switchTenant/optimistic'
          );

          try {
            // Make API call to switch tenant and update session
            const updatedTenant = await apiCall(tenantId);

            // Update with confirmed tenant data from server
            set(
              {
                currentTenant: updatedTenant,
                isLoading: false,
                lastSwitchTimestamp: Date.now(),
              },
              false,
              'switchTenant/success'
            );
          } catch (error) {
            // Rollback on error
            const errorMessage = error instanceof Error
              ? error.message
              : 'Failed to switch tenant';

            set(
              {
                currentTenant: previousTenant,
                isLoading: false,
                error: errorMessage,
              },
              false,
              'switchTenant/rollback'
            );

            throw error;
          }
        },

        // Toggle switcher UI state
        setSwitcherOpen: (open: boolean) => {
          set(
            { switcherOpen: open },
            false,
            'setSwitcherOpen'
          );
        },

        // Set loading state
        setLoading: (loading: boolean) => {
          set(
            { isLoading: loading },
            false,
            'setLoading'
          );
        },

        // Set error state
        setError: (error: string | null) => {
          set(
            { error },
            false,
            'setError'
          );
        },

        // Reset to initial state
        reset: () => {
          set(initialState, false, 'reset');
        },
      }),
      {
        name: 'gibson-tenant-store',
        // Only persist certain fields to localStorage
        partialize: (state) => ({
          // Don't persist loading/error states
          currentTenant: state.currentTenant,
          lastSwitchTimestamp: state.lastSwitchTimestamp,
        }),
      }
    ),
    {
      name: 'TenantStore',
      enabled: process.env.NODE_ENV === 'development',
    }
  )
);

// ============================================================================
// Selectors (convenience hooks)
// ============================================================================

/**
 * Hook to get current tenant
 */
export const useCurrentTenant = () =>
  useTenantStore((state) => state.currentTenant);

/**
 * Hook to get available tenants
 */
export const useAvailableTenants = () =>
  useTenantStore((state) => state.availableTenants);

/**
 * Hook to get loading state
 */
export const useTenantLoading = () =>
  useTenantStore((state) => state.isLoading);

/**
 * Hook to get error state
 */
export const useTenantError = () =>
  useTenantStore((state) => state.error);

/**
 * Hook to get switcher open state
 */
export const useSwitcherOpen = () =>
  useTenantStore((state) => state.switcherOpen);

/**
 * Hook to get tenant actions
 */
export const useTenantActions = () =>
  useTenantStore(
    useShallow((state) => ({
      setCurrentTenant: state.setCurrentTenant,
      setAvailableTenants: state.setAvailableTenants,
      switchTenant: state.switchTenant,
      setSwitcherOpen: state.setSwitcherOpen,
      setLoading: state.setLoading,
      setError: state.setError,
      reset: state.reset,
    }))
  );

/**
 * Hook to check if user can switch to a specific tenant
 */
export const useCanSwitchToTenant = (tenantId: string) =>
  useTenantStore((state) =>
    state.availableTenants.some((t) => t.id === tenantId) &&
    state.currentTenant?.id !== tenantId
  );
