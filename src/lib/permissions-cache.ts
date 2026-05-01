/**
 * permissions-cache.ts
 *
 * Client-side permission caching for the dashboard. Wraps the
 * `/api/auth/my-permissions` server route (which in turn calls the
 * daemon's `GetMyPermissions` RPC server-side via Envoy) with a TTL-based
 * in-memory cache so the dashboard does not hammer the route on every
 * component render.
 *
 * Spec: zero-trust-hardening Requirements 6.1, 6.2 — the previous
 * implementation built a `createGrpcWebTransport` against
 * `NEXT_PUBLIC_GIBSON_DAEMON_URL` directly from the browser. That bypassed
 * the Envoy edge (the single jwt_authn / ext_authz / SPIFFE-mTLS
 * checkpoint) and contradicted the platform's "always through Envoy"
 * doctrine. The browser-side gRPC client has been deleted; calls now go
 * through the server route, which uses the standard `userClient`
 * server-side transport.
 *
 * Design constraints:
 *  - Cache is a plain Map with timestamps — no third-party cache lib.
 *  - TTL defaults to 5 minutes; overridable via
 *    NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS environment variable.
 *  - `invalidatePermissionsCache()` forces a fresh fetch on next access.
 *  - SSR-safe: the singleton is module-scoped; the fetch is relative-URL
 *    so it works in both Node-edge runtimes and the browser.
 *
 * Usage
 * -----
 *   // In a client component (use the hook wrapper):
 *   import { useMyPermissions } from '@/src/lib/permissions-cache';
 *   const { permissions, loading } = useMyPermissions(tenantId);
 *
 *   // From other client code paths (rare):
 *   import { getMyPermissions } from '@/src/lib/permissions-cache';
 *   const perms = await getMyPermissions(tenantId);
 */

'use client';

import { fromJson, type JsonValue } from '@bufbuild/protobuf';
import {
  GetMyPermissionsResponseSchema,
  type GetMyPermissionsResponse,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { useEffect, useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 5 * 60 * 1_000; // 5 minutes

function getTTLMs(): number {
  const raw =
    typeof process !== 'undefined'
      ? process.env['NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS']
      : undefined;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_MS;
}

// ---------------------------------------------------------------------------
// Cache store
// ---------------------------------------------------------------------------

interface CacheEntry {
  value: GetMyPermissionsResponse;
  expiresAt: number;
}

// Module-scoped Map — one entry per tenantId.
const _cache = new Map<string, CacheEntry>();

/** Remove all cached entries, forcing a fresh fetch on next access. */
export function invalidatePermissionsCache(): void {
  _cache.clear();
}

/** Remove the cache entry for a specific tenant only. */
export function invalidateTenantPermissions(tenantId: string): void {
  _cache.delete(tenantId);
}

// ---------------------------------------------------------------------------
// Server-route fetch
// ---------------------------------------------------------------------------
//
// Replaces the previous browser-side gRPC-Web transport. The server route
// at `/api/auth/my-permissions` requires an Auth.js session and calls
// `GetMyPermissions` server-side via `userClient` (which routes through
// Envoy — see src/lib/gibson-client.ts). Per the zero-trust-hardening
// spec this is the ONLY supported path; no `NEXT_PUBLIC_GIBSON_DAEMON_URL`
// is read anywhere.
//
// The route returns the JSON-serialized `GetMyPermissionsResponse`. We
// rehydrate it through `fromJson` so the in-memory shape callers see is
// identical to what the gRPC client previously returned.

async function fetchMyPermissionsViaRoute(
  tenantId: string,
): Promise<GetMyPermissionsResponse> {
  const url = `/api/auth/my-permissions?tenantId=${encodeURIComponent(tenantId)}`;
  const resp = await fetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    // Let the browser HTTP cache honour the route's `Cache-Control: private`
    // response header. Our in-process cache below is a second layer.
  });
  if (!resp.ok) {
    let detail = '';
    try {
      const body = (await resp.json()) as { error?: string; detail?: string };
      detail = body.detail ?? body.error ?? '';
    } catch {
      detail = await resp.text().catch(() => '');
    }
    throw new Error(
      `my-permissions route returned ${resp.status}${detail ? `: ${detail}` : ''}`,
    );
  }
  const json = (await resp.json()) as JsonValue;
  return fromJson(GetMyPermissionsResponseSchema, json);
}

// ---------------------------------------------------------------------------
// Core fetch function
// ---------------------------------------------------------------------------

/**
 * getMyPermissions fetches (or returns from cache) the caller's permissions
 * for the given tenant.
 *
 * Pass `forceRefresh = true` to bypass the cache and force a network call.
 */
export async function getMyPermissions(
  tenantId: string,
  forceRefresh = false,
): Promise<GetMyPermissionsResponse> {
  const now = Date.now();
  const cached = _cache.get(tenantId);
  if (!forceRefresh && cached && now < cached.expiresAt) {
    return cached.value;
  }

  const resp = await fetchMyPermissionsViaRoute(tenantId);

  _cache.set(tenantId, {
    value: resp,
    expiresAt: now + getTTLMs(),
  });

  return resp;
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseMyPermissionsResult {
  permissions: GetMyPermissionsResponse | null;
  loading: boolean;
  error: Error | null;
  refresh: () => void;
}

/**
 * useMyPermissions is a React hook that fetches and caches the current user's
 * permissions for the given tenant.
 *
 * @param tenantId - The tenant to fetch permissions for.
 */
export function useMyPermissions(tenantId: string): UseMyPermissionsResult {
  const [permissions, setPermissions] = useState<GetMyPermissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const refresh = useCallback(() => {
    invalidateTenantPermissions(tenantId);
    setRefreshCount((c) => c + 1);
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getMyPermissions(tenantId)
      .then((resp) => {
        if (!cancelled) {
          setPermissions(resp);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId, refreshCount]);

  return { permissions, loading, error, refresh };
}
