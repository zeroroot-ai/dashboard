'use client';

/**
 * Tenant store — context-backed compatibility shim.
 *
 * The dashboard's nine tenant-scoped data hooks (useMissions, useFindings,
 * useAlerts, useAnalytics, useComponents, useTraces, useGraph,
 * useWidgetLayout, useMissionCreation) call `useTenantStore((s) =>
 * s.currentTenant)` to scope React Query keys and daemon-RPC requests to
 * the active tenant. This module preserves that selector API but reads
 * from `TenantContextProvider` (server-hydrated, see `tenant-context.tsx`)
 * instead of the original Zustand persist store.
 *
 * The store shape is kept identical so consumers compile unchanged. Only
 * the read fields (`currentTenant`, `availableTenants`, `isLoading`) are
 * live; mutation methods are no-ops — callers that need to switch tenants
 * use `switchActiveTenantAction` from
 * `@/components/gibson/shared/tenant-switcher-action`, not the store.
 */

import { useTenantContext } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

// ---------------------------------------------------------------------------
// Internal: pull live tenant fields off the React context.
// ---------------------------------------------------------------------------

function useContextTenants(): {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
} {
  const ctx = useTenantContext();
  return {
    currentTenant: ctx.currentTenant,
    availableTenants: ctx.availableTenants,
    isLoading: ctx.isLoading,
  };
}

// ---------------------------------------------------------------------------
// useTenantStore — Zustand-selector-compatible shim.
// ---------------------------------------------------------------------------

interface TenantStateCompat {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  isLoading: boolean;
  error: null;
  switcherOpen: boolean;
  lastSwitchTimestamp: null;
  setCurrentTenant: (_: unknown) => undefined;
  setAvailableTenants: (_: unknown) => undefined;
  switchTenant: (_id: string, _api: unknown) => Promise<undefined>;
  setSwitcherOpen: (_: unknown) => undefined;
  setLoading: (_: unknown) => undefined;
  setError: (_: unknown) => undefined;
  reset: () => undefined;
}

/**
 * Zustand-selector-compatible hook shim.
 *
 * Reads live tenant state from `TenantContextProvider` and projects it
 * through the provided selector. Read-only fields are live; mutators are
 * no-ops — switching is performed by `switchActiveTenantAction`.
 *
 * @deprecated Direct callers should migrate to `useTenantContext()` or
 *   the named selector hooks below.
 */
export function useTenantStore<T>(selector: (state: TenantStateCompat) => T): T {
  const { currentTenant, availableTenants, isLoading } = useContextTenants();

  const state: TenantStateCompat = {
    currentTenant,
    availableTenants,
    isLoading,
    error: null,
    switcherOpen: false,
    lastSwitchTimestamp: null,
    setCurrentTenant: () => undefined,
    setAvailableTenants: () => undefined,
    switchTenant: async () => undefined,
    setSwitcherOpen: () => undefined,
    setLoading: () => undefined,
    setError: () => undefined,
    reset: () => undefined,
  };

  return selector(state);
}

// ---------------------------------------------------------------------------
// Public selector hooks — same names as the deleted Zustand selectors.
// ---------------------------------------------------------------------------

/**
 * Returns the currently active Tenant, or null if none is selected.
 */
export function useCurrentTenant(): Tenant | null {
  return useContextTenants().currentTenant;
}

/**
 * Returns every Tenant the user is a member of.
 */
export function useAvailableTenants(): Tenant[] {
  return useContextTenants().availableTenants;
}

/**
 * Always false — server-resolved props arrive synchronously with the layout
 * render. Retained for API compatibility.
 */
export function useTenantLoading(): boolean {
  return useContextTenants().isLoading;
}

/**
 * Always null — errors surface via the switch action result and toasts.
 */
export function useTenantError(): null {
  return null;
}

/**
 * Always false — switcher open state is local UI state inside the
 * switcher component now.
 *
 * @deprecated Migrate callers to local useState.
 */
export function useSwitcherOpen(): boolean {
  return false;
}

/**
 * No-op mutator bag. Switching is performed by `switchActiveTenantAction`
 * from `@/components/gibson/shared/tenant-switcher-action`.
 *
 * @deprecated Use the Server Action directly.
 */
export function useTenantActions() {
  return {
    setCurrentTenant: (_: unknown) => undefined,
    setAvailableTenants: (_: unknown) => undefined,
    switchTenant: async (_id: string, _api: unknown) => undefined,
    setSwitcherOpen: (_: unknown) => undefined,
    setLoading: (_: unknown) => undefined,
    setError: (_: unknown) => undefined,
    reset: () => undefined,
  };
}

/**
 * Returns true if the user can switch to the given tenant (i.e. they hold
 * membership and it is not the active one).
 */
export function useCanSwitchToTenant(tenantId: string): boolean {
  const { currentTenant, availableTenants } = useContextTenants();
  if (currentTenant?.id === tenantId) return false;
  return availableTenants.some((t) => t.id === tenantId);
}
