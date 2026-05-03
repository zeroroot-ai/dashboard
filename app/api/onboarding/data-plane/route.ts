/**
 * GET /api/onboarding/data-plane
 *
 * Returns the data-plane provisioning status for the authenticated user's
 * tenant by reading `status.dataPlane.stores` from the Tenant CRD.
 *
 * Shape:
 *   { postgres: { state, reason, lastUpdated },
 *     redis:    { state, reason, lastUpdated },
 *     neo4j:    { state, reason, lastUpdated } }
 *
 * Each `state` is one of: "provisioning" | "ready" | "failed" | null.
 * null means the field is absent on the CRD (legacy CR or not yet started).
 *
 * Used by the onboarding page to poll live provisioning progress (D8).
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getTenant } from '@/src/lib/k8s/tenants';
import { K8sNotFoundError } from '@/src/lib/k8s/errors';
import { safeErrorResponse } from '@/src/lib/api-errors';
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
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = session.user?.tenantId;
  if (!tenantId) {
    return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
  }

  try {
    const cr = await getTenant(tenantId);
    const stores = cr.status?.dataPlane?.stores;

    const payload: DataPlaneStatus = {
      postgres: mapStore(stores?.postgres),
      redis: mapStore(stores?.redis),
      neo4j: mapStore(stores?.neo4j),
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof K8sNotFoundError) {
      // Tenant CR not yet created — provisioning hasn't started.
      const notStarted: DataPlaneStatus = {
        postgres: { state: null, reason: null, lastUpdated: null },
        redis: { state: null, reason: null, lastUpdated: null },
        neo4j: { state: null, reason: null, lastUpdated: null },
      };
      return NextResponse.json(notStarted);
    }

    return safeErrorResponse(error, 'Failed to read data-plane status', 500);
  }
}
