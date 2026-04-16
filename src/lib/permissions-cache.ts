/**
 * permissions-cache.ts
 *
 * Client-side permission caching for the dashboard. Wraps the
 * GetMyPermissions RPC with a TTL-based in-memory cache so the
 * dashboard does not hammer the daemon on every component render.
 *
 * Design constraints (per authz-04 spec, Requirements 6.4, 6.5):
 *  - Cache is a plain Map with timestamps — no third-party cache lib.
 *  - TTL defaults to 5 minutes; overridable via
 *    NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS environment variable.
 *  - `invalidatePermissionsCache()` forces a fresh fetch on next access.
 *  - SSR-safe: the singleton is module-scoped, which works for both RSC
 *    (server singleton per request in Node edge runtime) and client components.
 *
 * Usage
 * -----
 *   // In a server component or API route (pass the user's access token):
 *   import { getMyPermissions } from '@/src/lib/permissions-cache';
 *   const perms = await getMyPermissions(tenantId, accessToken);
 *
 *   // In a client component (no access token — browser side auth is not
 *   // supported server-to-server, so use the hook wrapper instead):
 *   import { useMyPermissions } from '@/src/lib/permissions-cache';
 *   const { permissions, loading } = useMyPermissions();
 */

'use client';

import { createClient } from '@connectrpc/connect';
import { createGrpcWebTransport } from '@connectrpc/connect-web';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import type { GetMyPermissionsResponse } from '@/src/gen/gibson/daemon/v1/daemon_pb';
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
// gRPC client (browser-side, uses grpc-web transport)
// ---------------------------------------------------------------------------

function getBrowserClient() {
  const baseUrl =
    typeof window !== 'undefined'
      ? (process.env['NEXT_PUBLIC_GIBSON_DAEMON_URL'] ?? '')
      : '';

  const transport = createGrpcWebTransport({ baseUrl });
  return createClient(DaemonService, transport);
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

  const client = getBrowserClient();
  const resp = await client.getMyPermissions({ tenantId });

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
