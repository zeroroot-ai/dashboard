/**
 * GET /api/auth/reserved-names
 *
 * Returns the chart-managed reserved-names denylist used by the signup form
 * to validate the workspace slug before submission. Proxies to the daemon's
 * `gibson.daemon.operator.v1.DaemonOperatorService/GetReservedNames` via Envoy
 * with the dashboard pod's service identity.
 *
 * Public route — no user auth required. The denylist is non-sensitive
 * (it is also visible to anyone who can describe the gibson-reserved-names
 * ConfigMap), and the form needs it before the user has a session.
 *
 * In-process 30-second cache so back-to-back signup attempts don't
 * fan out to the daemon. The daemon-side provider keeps its own 30s
 * cache against the K8s API; this layer protects against bursty signup
 * traffic in the gateway.
 *
 * Spec: tenant-provisioning-unification-phase2 Requirement 4.5.
 */

import { NextResponse } from 'next/server';
import { create } from '@bufbuild/protobuf';

import { serviceClient } from '@/src/lib/gibson-client';
import {
  DaemonOperatorService,
  GetReservedNamesRequestSchema,
} from '@/src/gen/gibson/daemon/operator/v1/operator_pb';

interface CachedDenylist {
  exact: string[];
  prefix: string[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cached: CachedDenylist | null = null;

async function fetchDenylist(): Promise<CachedDenylist> {
  // The signup form runs unauthenticated, so we need the service-acting
  // path. Tenant header is irrelevant here (the RPC is rule-mode and only
  // the caller's identity is checked), so we pass an empty string.
  const client = serviceClient(DaemonOperatorService, '');
  const resp = await client.getReservedNames(create(GetReservedNamesRequestSchema));
  return {
    exact: resp.exact ?? [],
    prefix: resp.prefix ?? [],
    fetchedAt: Date.now(),
  };
}

export async function GET(): Promise<NextResponse> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return NextResponse.json({ exact: cached.exact, prefix: cached.prefix });
  }

  try {
    const fresh = await fetchDenylist();
    cached = fresh;
    return NextResponse.json({ exact: fresh.exact, prefix: fresh.prefix });
  } catch (err) {
    // Never block signup on a denylist fetch failure. Return an empty
    // list with a 200 so client-side validation falls back to the form's
    // built-in regex check; the K8s admission webhook is the authoritative
    // gate and will still reject reserved names server-side.
    console.warn(
      '[reserved-names] daemon GetReservedNames failed, serving empty denylist',
      err,
    );
    return NextResponse.json({ exact: [], prefix: [] });
  }
}
