"use client";

/**
 * Tenant Context
 *
 * Lightweight React Context that surfaces tenant state from the Auth.js
 * session.  The Zustand persist store has been removed — tenant identity lives
 * exclusively in the OIDC `gibson:tenant` / `gibson:tenants` claims stored in
 * the encrypted Auth.js JWT cookie.
 *
 * TenantContextProvider is kept as a thin wrapper so that tenant-hydrator.tsx
 * and any future server-component wrappers continue to work without changes.
 * The `initialTenant` / `initialTenants` props are accepted for API
 * compatibility but are ignored — the session is the single source of truth.
 *
 * `switchTenant` now delegates to `switchTenantAction` (Server Action) which
 * triggers a Zitadel token refresh; the page must be refreshed afterwards to
 * pick up the new JWT.  Callers should use `router.refresh()` on success.
 */

import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { switchTenantAction } from "@/app/actions/tenant/switch";
import { useCurrentTenant, useAvailableTenants, useTenantLoading } from "@/src/stores/tenant-store";
import type { Tenant } from "@/src/types/tenant";

// ============================================================================
// Context Types
// ============================================================================

export interface TenantContextValue {
  /** Currently active tenant (from `gibson:tenant` OIDC claim). */
  currentTenant: Tenant | null;
  /** All tenants the user has access to (from `gibson:tenants` claim). */
  availableTenants: Tenant[];
  /** True while the Auth.js session is loading. */
  isLoading: boolean;
  /** Always null — errors are returned from switchTenant or shown as toasts. */
  error: string | null;
  /**
   * Switch to a different tenant.
   *
   * Calls switchTenantAction (Server Action) which updates Zitadel metadata
   * and triggers a token refresh.  On success the caller should call
   * `router.refresh()` to pick up the new JWT cookie.
   *
   * Throws if the Server Action returns an error.
   */
  switchTenant: (tenantId: string) => Promise<void>;
  /**
   * No-op — tenant list is always in sync with the session.
   * Retained for API compatibility.
   */
  refetchTenants: () => Promise<void>;
  /** Returns true if the user is a member of the given tenant and it differs from the current one. */
  canSwitchTenant: (tenantId: string) => boolean;
}

export interface TenantProviderProps {
  children: ReactNode;
  /**
   * Accepted for API compatibility with tenant-hydrator.tsx.
   * Ignored — session is the authoritative source.
   */
  initialTenant?: Tenant | null;
  /**
   * Accepted for API compatibility.
   * Ignored — session is the authoritative source.
   */
  initialTenants?: Tenant[];
}

// ============================================================================
// Context
// ============================================================================

const TenantContext = createContext<TenantContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function TenantContextProvider({
  children,
  // initialTenant and initialTenants are accepted but intentionally unused —
  // the Auth.js session JWT is the single source of truth.
  initialTenant: _initialTenant,
  initialTenants: _initialTenants,
}: TenantProviderProps) {
  const router = useRouter();

  const currentTenant = useCurrentTenant();
  const availableTenants = useAvailableTenants();
  const isLoading = useTenantLoading();

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = await switchTenantAction(tenantId);
      if (!result.ok) {
        throw new Error(result.error);
      }
      // Refresh the page so Next.js re-fetches server components with the new
      // JWT cookie (which now carries the updated gibson:tenant claim).
      router.refresh();
    },
    [router],
  );

  const refetchTenants = useCallback(async () => {
    // No-op: tenant list is derived from the OIDC token; refresh the session
    // by calling router.refresh() if needed.
  }, []);

  const canSwitchTenant = useCallback(
    (tenantId: string): boolean => {
      if (currentTenant?.id === tenantId) return false;
      return availableTenants.some((t) => t.id === tenantId);
    },
    [currentTenant, availableTenants],
  );

  const contextValue: TenantContextValue = {
    currentTenant,
    availableTenants,
    isLoading,
    error: null,
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
 */
export function useTenantContext(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error(
      "useTenantContext must be used within a TenantContextProvider.",
    );
  }
  return context;
}

// ============================================================================
// Display Names for DevTools
// ============================================================================

TenantContext.displayName = "TenantContext";
TenantContextProvider.displayName = "TenantContextProvider";
