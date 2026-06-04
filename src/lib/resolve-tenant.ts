/**
 * Server-side tenant resolution.
 *
 * Resolves a tenantId from the session into a full Tenant object from the
 * caller's FGA-backed membership list (daemon `ListMyMemberships`), NOT by
 * reading the Tenant CRD from Kubernetes. Per ADR-0044, tenant resolution is
 * an FGA/identity concern, not a Kubernetes operation — the dashboard's only
 * remaining K8s access is Tenant *provisioning* (signup) + billing lifecycle.
 *
 * Resolving from the membership list is also fail-closed by construction: a
 * tenant the caller is not a member of resolves to null, where the old CR read
 * would happily return any tenant's CR.
 *
 * MUST NOT be imported by browser-side code.
 */

import { getMyMemberships } from '@/src/lib/auth/membership';
import type { Tenant } from '@/src/types/tenant';

/**
 * Resolve a tenantId into a full Tenant object via the caller's memberships.
 *
 * Returns null if the caller is not a member of the tenant or membership
 * resolution fails (FGA/daemon unavailable) — callers handle null gracefully
 * (the layout drops nulls so a single miss doesn't break chrome render).
 *
 * Note: rich CR-only fields (creationTimestamp, owner, exact memberCount) are
 * not available from the membership projection and degrade to defaults. The
 * resolution surface only needs id / name / displayName for the switcher,
 * header, and TenantContextProvider.
 */
export async function resolveTenant(
  tenantId: string,
  _userId: string | undefined,
): Promise<Tenant | null> {
  try {
    const memberships = await getMyMemberships();
    const membership = memberships.find((m) => m.tenantId === tenantId);
    if (!membership) return null;
    return {
      id: membership.tenantId,
      name: membership.tenantId,
      displayName: membership.tenantName || membership.tenantId,
      settings: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
      createdBy: 'unknown',
      memberCount: 0,
    };
  } catch {
    return null;
  }
}
