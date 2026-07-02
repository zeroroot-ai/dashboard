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
 *   const { currentTenant, switchTenant, isLoading } = useTenant();
 *
 *   if (isLoading) return <Skeleton />;
 *
 *   return (
 *     <div>
 *       <h1>Current: {currentTenant?.displayName}</h1>
 *       <button onClick={() => switchTenant('other-tenant')}>
 *         Switch
 *       </button>
 *     </div>
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
     * Switch to a different tenant by ID.
     * Invalidates all React Query caches automatically.
     *
     * @param tenantId - The ID of the tenant to switch to
     * @throws {Error} If tenant is not in available tenants or API call fails
     */
    switchTenant: context.switchTenant,

    /**
     * Refresh the list of available tenants from the server.
     *
     * @throws {Error} If API call fails
     */
    refetchTenants: context.refetchTenants,

    /**
     * Check if the user can switch to a specific tenant.
     *
     * @param tenantId - The ID of the tenant to check
     * @returns true if the user can switch to this tenant
     */
    canSwitchTenant: context.canSwitchTenant,

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
     * Check if user has access to multiple tenants.
     * Useful for conditionally showing the tenant switcher.
     */
    hasMultipleTenants: context.availableTenants.length > 1,

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
