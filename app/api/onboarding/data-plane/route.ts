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
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import type {
  DataPlaneStatus,
  DataPlaneStoreState,
  StoreStatus,
} from '@/src/types/onboarding';

const NOT_STARTED: StoreStatus = { state: null, reason: null, lastUpdated: null };

const KNOWN_STATES: readonly DataPlaneStoreState[] = ['provisioning', 'ready', 'failed'];

/**
 * Map an operator-reported store state string to the API response shape. The
 * daemon snapshot (read via the daemon, dashboard#813/#855) carries only the
 * coarse state ("", "Provisioning", "Ready", "Failed" — case-insensitive); the
 * per-store reason/lastUpdated were Tenant-CR-only details and are reported as
 * null now that the dashboard no longer reads the CR directly. Unknown / empty
 * states collapse to not-started.
 */
function mapStore(state: string): StoreStatus {
  const normalized = state.toLowerCase();
  const known = KNOWN_STATES.find((s) => s === normalized);
  return known ? { state: known, reason: null, lastUpdated: null } : NOT_STARTED;
}

export async function GET() {
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const status = await getTenantProvisioningStatus(tenantId);

    // found: false (or all-empty stores) ⇒ provisioning hasn't started.
    const payload: DataPlaneStatus = {
      postgres: mapStore(status.stores.postgres),
      redis: mapStore(status.stores.redis),
      graph: mapStore(status.stores.neo4j),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
