/**
 * Server-side tenant resolution.
 *
 * Resolves a tenantId from the session into a full Tenant object by reading
 * the Tenant CRD from Kubernetes. Used by the auth layout to hydrate
 * TenantContextProvider.
 *
 * MUST NOT be imported by browser-side code.
 */

import { getTenant } from '@/src/lib/k8s/tenants';
import type { Tenant as TenantCR } from '@/src/lib/k8s/types';
import type { Tenant } from '@/src/types/tenant';

/**
 * Map a Tenant CR to the frontend Tenant shape.
 */
function tenantCRToTenant(cr: TenantCR): Tenant {
  const created = cr.metadata.creationTimestamp
    ? new Date(cr.metadata.creationTimestamp)
    : new Date(0);
  return {
    id: cr.metadata.name,
    name: cr.metadata.name,
    displayName: cr.spec.displayName || cr.metadata.name,
    settings: {},
    createdAt: created,
    updatedAt: created,
    createdBy: cr.spec.owner || 'unknown',
    memberCount: 0,
  };
}

/**
 * Resolve a tenantId into a full Tenant object via the Tenant CRD.
 *
 * Returns null if the tenant cannot be resolved (CR not found, k8s error,
 * etc.) — callers should handle the null case gracefully.
 */
export async function resolveTenant(
  tenantId: string,
  _userId: string | undefined,
): Promise<Tenant | null> {
  try {
    const cr = await getTenant(tenantId);
    return tenantCRToTenant(cr);
  } catch {
    return null;
  }
}
