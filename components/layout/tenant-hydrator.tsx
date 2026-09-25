// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * TenantHydrator
 *
 * Thin client wrapper that mounts TenantContextProvider with state resolved
 * server-side from the enriched session (`getServerSession`), which reads
 * the person's one tenant (resolved server-side onto the session at
 * sign-in, ADR-0093 decision 4) and re-checks it against FGA membership.
 *
 * The auth layout (a Server Component) calls `getServerSession()` once per
 * render, resolves the tenant's CRD, and passes the full authz state
 * through this component. The provider treats those props as authoritative
 * on every render; there are NO client-side `useSession()` reads of
 * tenant / permission state, and there is no tenant switching (a person
 * has exactly one tenant).
 */

import type { ReactNode } from 'react';
import { TenantContextProvider } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

interface TenantHydratorProps {
  /** Currently active tenant (full Tenant CRD), or null if none selected. */
  currentTenant: Tenant | null;
  /** Every tenant the user is a member of (resolved CRDs, nulls dropped). */
  availableTenants: Tenant[];
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
  crossTenant,
  rolesByTenant,
  groups,
  children,
}: TenantHydratorProps) {
  return (
    <TenantContextProvider
      currentTenant={currentTenant}
      availableTenants={availableTenants}
      crossTenant={crossTenant}
      rolesByTenant={rolesByTenant}
      groups={groups}
    >
      {children}
    </TenantContextProvider>
  );
}
