/**
 * permissions-cache.test.ts
 *
 * Unit tests for the PermissionsCache module. Covers cache
 * hit/miss/TTL/invalidation behaviour without making real network calls.
 *
 * Spec: zero-trust-hardening Req 6.1, 6.2 — the module no longer holds a
 * direct gRPC client. It calls the server route `/api/auth/my-permissions`
 * via `fetch`. These tests stub `globalThis.fetch` accordingly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create, toJson } from '@bufbuild/protobuf';
import {
  GetMyPermissionsResponseSchema,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';

import {
  getMyPermissions,
  invalidatePermissionsCache,
  invalidateTenantPermissions,
} from './permissions-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(role: string) {
  return create(GetMyPermissionsResponseSchema, {
    tenantId: 'test-tenant',
    role,
    isAdmin: role === 'admin',
    componentGrants: [],
    teamMemberships: [],
  });
}

function jsonResponse(role: string): Response {
  const proto = makeResponse(role);
  const body = toJson(GetMyPermissionsResponseSchema, proto);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const fetchMock = vi.fn();

beforeEach(() => {
  invalidatePermissionsCache();
  fetchMock.mockReset();
  // Install on the global. Vitest's jsdom env exposes `fetch` on
  // `globalThis`; we replace it for each test and restore in afterEach.
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('getMyPermissions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns permissions on first call (cache miss)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('member'));

    const result = await getMyPermissions('test-tenant');

    expect(result.role).toBe('member');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/my-permissions?tenantId=test-tenant',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    );
  });

  it('returns cached value on second call (cache hit)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse('admin'));

    await getMyPermissions('test-tenant');
    const result = await getMyPermissions('test-tenant');

    expect(result.role).toBe('admin');
    // Network call only happened once.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('re-fetches after TTL expires', async () => {
    const TTL = parseInt(
      process.env['NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS'] ?? '300000',
      10,
    );

    fetchMock
      .mockResolvedValueOnce(jsonResponse('member'))
      .mockResolvedValueOnce(jsonResponse('admin'));

    await getMyPermissions('test-tenant');
    // Advance time past the TTL.
    vi.advanceTimersByTime(TTL + 1);

    const result = await getMyPermissions('test-tenant');
    expect(result.role).toBe('admin');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when forceRefresh is true', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse('viewer'))
      .mockResolvedValueOnce(jsonResponse('operator'));

    await getMyPermissions('test-tenant');
    const result = await getMyPermissions('test-tenant', true);

    expect(result.role).toBe('operator');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('isolates cache entries per tenant', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse('admin'))
      .mockResolvedValueOnce(jsonResponse('member'));

    const r1 = await getMyPermissions('acme');
    const r2 = await getMyPermissions('beta');

    expect(r1.role).toBe('admin');
    expect(r2.role).toBe('member');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws when the route returns a non-2xx status', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthenticated' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(getMyPermissions('test-tenant')).rejects.toThrow(/401/);
  });
});

describe('invalidatePermissionsCache', () => {
  it('clears all cached entries', async () => {
    // Each invocation must produce a fresh Response — Response bodies can
    // only be consumed once, so a single shared instance breaks on the
    // second call.
    fetchMock.mockImplementation(async () => jsonResponse('member'));

    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b');

    invalidatePermissionsCache();

    await getMyPermissions('tenant-a');
    // 3 calls total: 2 initial + 1 after invalidation.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('invalidateTenantPermissions', () => {
  it('clears only the specified tenant', async () => {
    fetchMock.mockImplementation(async () => jsonResponse('member'));

    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b');

    invalidateTenantPermissions('tenant-a');

    // Re-fetch tenant-a only.
    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b'); // should still be cached

    // 3 calls: 2 initial + 1 re-fetch for tenant-a; tenant-b hits cache.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
