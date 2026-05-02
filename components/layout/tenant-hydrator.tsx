'use client';

/**
 * TenantHydrator
 *
 * Thin client wrapper that mounts TenantContextProvider with state resolved
 * server-side from the enriched session (`getServerSession`) and the
 * `gibson_active_tenant` cookie + FGA membership lookup.
 *
 * The auth layout (a Server Component) calls `getServerSession()` once per
 * render, resolves the active + member tenant CRDs, and passes the full
 * authz state through this component. The provider treats those props as
 * authoritative on every render — there are NO client-side `useSession()`
 * reads of tenant / permission state. After a successful tenant switch
 * (`switchActiveTenantAction` + `router.refresh()`) the layout re-renders
 * with new props and the context re-hydrates.
 */

import type { ReactNode } from 'react';
import { TenantContextProvider } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

interface TenantHydratorProps {
  /** Currently active tenant (full Tenant CRD), or null if none selected. */
  currentTenant: Tenant | null;
  /** Every tenant the user is a member of (resolved CRDs, nulls dropped). */
  availableTenants: Tenant[];
  /** Effective permissions for the active tenant (deny when missing). */
  permissions: string[];
  /** True when the user holds at least one role flagged cross_tenant. */
  crossTenant: boolean;
  /** Map of tenantId → role string ("admin" | "member"). */
  rolesByTenant: Record<string, string>;
  /** IdP-asserted groups (currently always empty; reserved for future use). */
  groups: string[];
  children: ReactNode;
}

export function TenantHydrator({
  currentTenant,
  availableTenants,
  permissions,
  crossTenant,
  rolesByTenant,
  groups,
  children,
}: TenantHydratorProps) {
  return (
    <TenantContextProvider
      currentTenant={currentTenant}
      availableTenants={availableTenants}
      permissions={permissions}
      crossTenant={crossTenant}
      rolesByTenant={rolesByTenant}
      groups={groups}
    >
      {children}
    </TenantContextProvider>
  );
}
