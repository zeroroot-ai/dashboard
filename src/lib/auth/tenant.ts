'use client';

/**
 * Client-side hooks for accessing tenant + permission state from the
 * server-hydrated `TenantContextProvider`.
 *
 * These hooks gate UI on the current user's tenant or permissions. The
 * underlying state is resolved server-side on every layout render via
 * `getServerSession()` — which reads the `gibson_active_tenant` cookie,
 * calls `getMyMemberships()` against FGA, and computes effective
 * permissions from the daemon's permissions schema. The resolved values
 * are passed through `<TenantHydrator>` and surfaced here.
 *
 * Permission resolution is fully driven by the daemon's permissions.yaml
 * schema (declarative-rbac-framework spec). The permissions array is
 * computed server-side and stored on the context — these hooks read that
 * flat array directly, no client-side role mapping.
 *
 * For Server Components, use hasPermission() / isCrossTenant() from
 * '@/src/lib/auth/schema' instead.
 */

import { useTenantContext } from '@/src/lib/tenant-context';

/**
 * Hook to get the current tenant ID from the active tenant.
 */
export function useTenantId(): string | null {
  return useTenantContext().currentTenant?.id ?? null;
}

/**
 * Hook to get every tenant slug the current user is a member of.
 */
export function useAvailableTenants(): string[] {
  return useTenantContext().availableTenants.map((t) => t.id);
}

/**
 * Hook to check if the current user has multiple tenants.
 */
export function useHasMultipleTenants(): boolean {
  return useTenantContext().availableTenants.length > 1;
}


/**
 * Hook returning true when the user holds at least one role flagged
 * cross_tenant=true in the daemon schema (platform-operator, provisioner,
 * *-executor). Use for UI that operates across tenant boundaries.
 */
export function useIsCrossTenant(): boolean {
  return useTenantContext().crossTenant;
}

/**
 * Hook to get the current user's groups from the identity provider.
 */
export function useGroups(): string[] {
  return useTenantContext().groups;
}
