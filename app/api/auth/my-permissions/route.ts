/**
 * GET /api/auth/my-permissions
 *
 * Server-side endpoint that returns the authenticated user's permissions
 * within the active session tenant. The endpoint exists so the browser
 * never has to hold a daemon-direct gRPC transport, every call to the
 * daemon flows through Envoy via the server-side `userClient` wrapper.
 *
 * Tenant context is resolved via `requireActiveTenant()` (the HMAC-signed
 * `gibson_active_tenant` cookie per spec `tenant-membership-not-in-jwt`);
 * it is NOT accepted from a URL query string. Putting the slug in the URL
 * leaked the tenant identifier into browser history / referer / access logs
 * (dashboard#209).
 *
 * Spec: zero-trust-hardening Requirements 6.1, 6.2, restore the
 * "always through Envoy" doctrine in code by removing the browser-side
 * `createGrpcWebTransport` constructor and replacing the call site with a
 * fetch to this route.
 *
 * Behaviour:
 *   - Returns `401 { error: 'unauthenticated' }` when no Auth.js session.
 *   - Returns `400 { error: 'no-active-tenant' }` when the session has no
 *     active tenant (user has not yet selected one).
 *   - On success, returns the JSON-serialized `GetMyPermissionsResponse`
 *     with `Cache-Control: private, max-age=<NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS / 1000>`.
 *     The response is per-user; the server itself does NOT cache across
 *     users, only the standard HTTP private-cache semantics apply.
 *   - Returns `502 { error: 'daemon-unavailable' }` if the daemon RPC fails.
 *
 * @module api/auth/my-permissions
 */

import 'server-only';

import { NextResponse } from 'next/server';
import { toJson } from '@bufbuild/protobuf';

import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import {
  DaemonService,
  GetMyPermissionsResponseSchema,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';

const DEFAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes, mirrors permissions-cache.ts

function getTtlSeconds(): number {
  const raw = process.env['NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS'];
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return Math.floor(parsed / 1000);
    }
  }
  return Math.floor(DEFAULT_TTL_MS / 1000);
}

export async function GET(): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Tenant context comes from the active-tenant cookie resolver, never
  // from URL params (dashboard#209). See route module doc.
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const resp = await userClient(DaemonService).getMyPermissions({ tenantId });
    // Convert the proto message to a plain JSON object so the wire format
    // is identical to what the previous browser-side gRPC-Web client
    // produced after Connect's deserializer.
    const body = toJson(GetMyPermissionsResponseSchema, resp);
    const ttlSeconds = getTtlSeconds();
    return NextResponse.json(body, {
      status: 200,
      headers: {
        // Per-user cache only, `private` keeps the response out of any
        // shared (CDN / proxy) cache; `max-age` matches the in-memory TTL
        // the previous browser cache used.
        'Cache-Control': `private, max-age=${ttlSeconds}`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'daemon-unavailable', detail: message },
      { status: 502 },
    );
  }
}
