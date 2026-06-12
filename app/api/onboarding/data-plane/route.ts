/**
 * GET /api/onboarding/data-plane
 *
 * Returns the data-plane provisioning status for the authenticated user's
 * tenant by reading `status.dataPlane.stores` from the Tenant CRD.
 *
 * Wire shape (customer-facing, vendor-agnostic):
 *   { postgres: { state, reason, lastUpdated },
 *     redis:    { state, reason, lastUpdated },
 *     graph:    { state, reason, lastUpdated } }
 *
 * The CRD field for the knowledge-graph store is `stores.neo4j` (an
 * implementation detail owned by the tenant-operator). This route translates
 * that to `graph` in the response so the dashboard's wire shape stays
 * agnostic of the backend choice, see the customer-doc terminology rule.
 *
 * Each `state` is one of: "provisioning" | "ready" | "failed" | null.
 * null means the field is absent on the CRD (legacy CR or not yet started).
 *
 * Used by the onboarding page to poll live provisioning progress (D8).
 *
 * Tenant resolved via requireActiveTenant(), fail-closed, no default fallback.
 * Spec: dashboard-no-backing-store-clients (issue #579).
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { getTenant } from '@/src/lib/k8s/tenants';
import { K8sNotFoundError } from '@/src/lib/k8s/errors';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import type { DataPlaneStatus, StoreStatus } from '@/src/types/onboarding';
import type { DataPlaneStoreStatus } from '@/src/lib/k8s/types';

/** Map an optional CRD store entry to the API response shape. */
function mapStore(entry: DataPlaneStoreStatus | undefined): StoreStatus {
  if (!entry) {
    return { state: null, reason: null, lastUpdated: null };
  }
  return {
    state: entry.state,
    reason: entry.reason ?? null,
    lastUpdated: entry.lastUpdated ?? null,
  };
}

export async function GET() {
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const cr = await getTenant(tenantId);
    const stores = cr.status?.dataPlane?.stores;

    const payload: DataPlaneStatus = {
      postgres: mapStore(stores?.postgres),
      redis: mapStore(stores?.redis),
      graph: mapStore(stores?.neo4j),
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof K8sNotFoundError) {
      // Tenant CR not yet created, provisioning hasn't started.
      const notStarted: DataPlaneStatus = {
        postgres: { state: null, reason: null, lastUpdated: null },
        redis: { state: null, reason: null, lastUpdated: null },
        graph: { state: null, reason: null, lastUpdated: null },
      };
      return NextResponse.json(notStarted);
    }

    return daemonErrorResponse(error);
  }
}
