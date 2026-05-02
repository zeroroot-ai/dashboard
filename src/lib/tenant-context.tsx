"use client";

/**
 * Tenant Context
 *
 * Single source of truth for client-side tenant + authz state. Hydrated from
 * server-resolved props passed through `<TenantHydrator>` (mounted in the
 * auth layout). The server resolves state on every render via
 * `getServerSession()` + the `gibson_active_tenant` cookie + FGA membership
 * lookup; the client consumes the already-resolved props synchronously.
 *
 * IMPORTANT: this provider never reads `useSession()` tenant fields. The
 * Auth.js JWT cookie does NOT carry tenant / permission claims — they live
 * in the server-only `gibson_active_tenant` cookie + per-request FGA RPC.
 *
 * Tenant switching: `switchTenant` calls `switchActiveTenantAction`
 * (Server Action) which writes the HMAC-signed `gibson_active_tenant`
 * cookie via `setActiveTenant`, then triggers `router.refresh()` so the
 * layout re-renders with new props.
 */

import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { switchActiveTenantAction } from "@/components/gibson/shared/tenant-switcher-action";
import type { Tenant } from "@/src/types/tenant";

// ============================================================================
// Context Types
// ============================================================================

export interface TenantContextValue {
  /** Currently active tenant (full Tenant CRD), or null if none selected. */
  currentTenant: Tenant | null;
  /** Every tenant the user is a member of (resolved CRDs). */
  availableTenants: Tenant[];
  /** Effective permission strings for the active tenant. */
  permissions: string[];
  /** True when the user holds at least one role flagged cross_tenant. */
  crossTenant: boolean;
  /** Map of tenantId → role string ("admin" | "member"). */
  rolesByTenant: Record<string, string>;
  /** IdP-asserted groups (currently always empty). */
  groups: string[];
  /** Always false — props arrive synchronously with the server render. */
  isLoading: boolean;
  /** Always null — failures surface via switchTenant return value / toasts. */
  error: string | null;
  /**
   * Switch to a different tenant. Calls `switchActiveTenantAction` which
   * writes the HMAC-signed active-tenant cookie and validates membership;
   * on success the page is refreshed to pick up the new server-resolved
   * state. Throws on failure.
   */
  switchTenant: (tenantId: string) => Promise<void>;
  /**
   * Refresh server-resolved state. Equivalent to `router.refresh()` —
   * forces the layout to re-fetch memberships from FGA.
   */
  refetchTenants: () => Promise<void>;
  /** True if the user can switch to the given tenant (member, not active). */
  canSwitchTenant: (tenantId: string) => boolean;
}

export interface TenantProviderProps {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  permissions: string[];
  crossTenant: boolean;
  rolesByTenant: Record<string, string>;
  groups: string[];
  children: ReactNode;
}

// ============================================================================
// Context
// ============================================================================

const TenantContext = createContext<TenantContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function TenantContextProvider({
  currentTenant,
  availableTenants,
  permissions,
  crossTenant,
  rolesByTenant,
  groups,
  children,
}: TenantProviderProps) {
  const router = useRouter();

  const switchTenant = useCallback(
    async (tenantId: string) => {
      const result = await switchActiveTenantAction(tenantId);
      if (!result.ok) {
        const reason =
          result.reason === "not_a_member"
            ? "You are not a member of that workspace."
            : "Failed to resolve workspace membership.";
        throw new Error(reason);
      }
      router.refresh();
    },
    [router],
  );

  const refetchTenants = useCallback(async () => {
    router.refresh();
  }, [router]);

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
    permissions,
    crossTenant,
    rolesByTenant,
    groups,
    isLoading: false,
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
 * Hook to access tenant context. Must be used within a TenantContextProvider.
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
