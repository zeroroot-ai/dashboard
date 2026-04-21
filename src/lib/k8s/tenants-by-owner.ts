/**
 * K8s helper: list Tenant CRs owned by a specific email address.
 *
 * Reuses the same `k8s()` singleton as `src/lib/k8s/tenants.ts`.
 * Owner matching is case-insensitive; no label selectors are used
 * (owners are not labels — this is a server-side list + client-side filter).
 */

import 'server-only';

import { k8s } from './client';
import type { Tenant } from './types';

/**
 * Lists all Tenant CRs cluster-wide and returns those whose
 * `spec.owner` matches `email` (case-insensitive).
 *
 * Returns an empty array if no tenants exist or the caller has no tenants.
 * Never throws on a successful API call; propagates K8s API errors.
 */
export async function listTenantsForOwner(email: string): Promise<Tenant[]> {
  const normalised = email.toLowerCase();
  const all = await k8s().list<Tenant>('Tenant');
  return all.filter(
    (t) => typeof t.spec?.owner === 'string' && t.spec.owner.toLowerCase() === normalised,
  );
}
