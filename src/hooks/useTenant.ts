// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * useTenant Hook
 * Provides easy access to tenant context and common tenant operations
 */

import { useTenantContext } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Hook to access current tenant context and operations.
 * Must be used within a TenantContextProvider.
 *
 * @returns {TenantHookReturn} Tenant state and operations
 * @throws {Error} If used outside of TenantContextProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { currentTenant, isLoading } = useTenant();
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       <h1>Current: {currentTenant?.displayName}</h1>
 *   );
 * }
 * ```
 */
export function useTenant() {
  const context = useTenantContext();

  return {
    /** Currently selected tenant */
    currentTenant: context.currentTenant,

    /** All tenants the user has access to */
    availableTenants: context.availableTenants,

    /** Whether tenant operations are in progress */
    isLoading: context.isLoading,

    /** Error message if any operation failed */
    error: context.error,

    /**
     * Refresh the list of available tenants from the server.
     *
     * @throws {Error} If API call fails
     */
    refetchTenants: context.refetchTenants,

    /**
     * Get the current tenant ID, or null if no tenant is selected.
     */
    tenantId: context.currentTenant?.id ?? null,

    /**
     * Check if a specific tenant is currently selected.
     *
     * @param tenantId - The ID of the tenant to check
     * @returns true if this tenant is currently selected
     */
    isCurrentTenant: (tenantId: string): boolean =>
      context.currentTenant?.id === tenantId,

    /**
     * Find a tenant by ID from the available tenants.
     *
     * @param tenantId - The ID of the tenant to find
     * @returns The tenant object or undefined
     */
    getTenantById: (tenantId: string): Tenant | undefined =>
      context.availableTenants.find((t) => t.id === tenantId),
  };
}

// ============================================================================
// Export type for the hook return value
// ============================================================================

type UseTenantReturn = ReturnType<typeof useTenant>;
