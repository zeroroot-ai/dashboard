'use client';

/**
 * TenantHydrator
 *
 * Thin client wrapper that mounts TenantContextProvider with server-resolved
 * initial data. This exists because the auth layout is a Server Component and
 * cannot directly render a client context provider with async-resolved props.
 */

import type { ReactNode } from 'react';
import { TenantContextProvider } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

interface TenantHydratorProps {
  initialTenant: Tenant | null;
  initialTenants: Tenant[];
  children: ReactNode;
}

export function TenantHydrator({
  initialTenant,
  initialTenants,
  children,
}: TenantHydratorProps) {
  return (
    <TenantContextProvider
      initialTenant={initialTenant}
      initialTenants={initialTenants}
    >
      {children}
    </TenantContextProvider>
  );
}
