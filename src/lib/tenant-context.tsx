// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Tenant Context
 *
 * Single source of truth for client-side tenant + authz state. Hydrated from
 * server-resolved props passed through `<TenantHydrator>` (mounted in the
 * auth layout). The server resolves state on every render via
 * `getServerSession()`, which reads the person's one tenant from the
 * encrypted session (ADR-0093 decision 4) and re-validates it against
 * current FGA membership. The client consumes the already-resolved props
 * synchronously.
 *
 * IMPORTANT: this provider never reads `useSession()` directly. Server-
 * resolved props are the only source of tenant state on the client.
 *
 * There is no tenant switching. A person has exactly one tenant, resolved
 * server-side at sign-in from their token's verified Zitadel org, never
 * chosen client-side (ADR-0093 decision 4). The switch operations that the
 * old picker used are gone from this shape; nothing offers a choice.
 */

import {
  createContext,
  useContext,
  useCallback,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { Tenant } from "@/src/types/tenant";

// ============================================================================
// Context Types
// ============================================================================

interface TenantContextValue {
  /** Currently active tenant (full Tenant CRD), or null if none selected. */
  currentTenant: Tenant | null;
  /** Every tenant the user is a member of (resolved CRDs). */
  availableTenants: Tenant[];
  /** True when the user holds at least one role flagged cross_tenant. */
  crossTenant: boolean;
  /** Map of tenantId → role string ("owner" | "admin" | "writer" | "member"). */
  rolesByTenant: Record<string, string>;
  /** IdP-asserted groups (currently always empty). */
  groups: string[];
  /** Always false, props arrive synchronously with the server render. */
  isLoading: boolean;
  /** Always null, props arrive already resolved. */
  error: string | null;
  /**
   * Refresh server-resolved state. Equivalent to `router.refresh()` -
   * forces the layout to re-fetch memberships from FGA.
   */
  refetchTenants: () => Promise<void>;
}

interface TenantProviderProps {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
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
  crossTenant,
  rolesByTenant,
  groups,
  children,
}: TenantProviderProps) {
  const router = useRouter();

  const refetchTenants = useCallback(async () => {
    router.refresh();
  }, [router]);

  const contextValue: TenantContextValue = {
    currentTenant,
    availableTenants,
    crossTenant,
    rolesByTenant,
    groups,
    isLoading: false,
    error: null,
    refetchTenants,
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
