/**
 * permissions-cache.test.ts
 *
 * Unit tests for the PermissionsCache module (Requirements 6.4, 6.5).
 * Covers cache hit/miss/TTL/invalidation behaviour without making real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  GetMyPermissionsResponseSchema,
} from '@/src/gen/gibson/daemon/v1/daemon_pb';

// ---------------------------------------------------------------------------
// Hoisted mock: intercept the Connect-ES gRPC client before importing the
// module under test.
// ---------------------------------------------------------------------------

const mockGetMyPermissions = vi.fn();

vi.mock('@connectrpc/connect', () => ({
  createClient: vi.fn(() => ({
    getMyPermissions: mockGetMyPermissions,
  })),
}));

vi.mock('@connectrpc/connect-web', () => ({
  createGrpcWebTransport: vi.fn(() => ({})),
}));

// Import AFTER mocks are registered.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getMyPermissions', () => {
  beforeEach(() => {
    invalidatePermissionsCache();
    mockGetMyPermissions.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns permissions on first call (cache miss)', async () => {
    const resp = makeResponse('member');
    mockGetMyPermissions.mockResolvedValueOnce(resp);

    const result = await getMyPermissions('test-tenant');

    expect(result.role).toBe('member');
    expect(mockGetMyPermissions).toHaveBeenCalledOnce();
  });

  it('returns cached value on second call (cache hit)', async () => {
    const resp = makeResponse('admin');
    mockGetMyPermissions.mockResolvedValueOnce(resp);

    await getMyPermissions('test-tenant');
    const result = await getMyPermissions('test-tenant');

    expect(result.role).toBe('admin');
    // Network call only happened once.
    expect(mockGetMyPermissions).toHaveBeenCalledOnce();
  });

  it('re-fetches after TTL expires', async () => {
    const TTL = parseInt(process.env['NEXT_PUBLIC_PERMISSIONS_CACHE_TTL_MS'] ?? '300000', 10);

    const first = makeResponse('member');
    const second = makeResponse('admin');
    mockGetMyPermissions
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await getMyPermissions('test-tenant');
    // Advance time past the TTL.
    vi.advanceTimersByTime(TTL + 1);

    const result = await getMyPermissions('test-tenant');
    expect(result.role).toBe('admin');
    expect(mockGetMyPermissions).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when forceRefresh is true', async () => {
    const first = makeResponse('viewer');
    const second = makeResponse('operator');
    mockGetMyPermissions
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);

    await getMyPermissions('test-tenant');
    const result = await getMyPermissions('test-tenant', true);

    expect(result.role).toBe('operator');
    expect(mockGetMyPermissions).toHaveBeenCalledTimes(2);
  });

  it('isolates cache entries per tenant', async () => {
    const acme = makeResponse('admin');
    const beta = makeResponse('member');
    mockGetMyPermissions
      .mockResolvedValueOnce(acme)
      .mockResolvedValueOnce(beta);

    const r1 = await getMyPermissions('acme');
    const r2 = await getMyPermissions('beta');

    expect(r1.role).toBe('admin');
    expect(r2.role).toBe('member');
    expect(mockGetMyPermissions).toHaveBeenCalledTimes(2);
  });
});

describe('invalidatePermissionsCache', () => {
  beforeEach(() => {
    invalidatePermissionsCache();
    mockGetMyPermissions.mockReset();
  });

  it('clears all cached entries', async () => {
    mockGetMyPermissions.mockResolvedValue(makeResponse('member'));

    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b');

    invalidatePermissionsCache();

    await getMyPermissions('tenant-a');
    // 3 calls total: 2 initial + 1 after invalidation.
    expect(mockGetMyPermissions).toHaveBeenCalledTimes(3);
  });
});

describe('invalidateTenantPermissions', () => {
  beforeEach(() => {
    invalidatePermissionsCache();
    mockGetMyPermissions.mockReset();
  });

  it('clears only the specified tenant', async () => {
    mockGetMyPermissions.mockResolvedValue(makeResponse('member'));

    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b');

    invalidateTenantPermissions('tenant-a');

    // Re-fetch tenant-a only.
    await getMyPermissions('tenant-a');
    await getMyPermissions('tenant-b'); // should still be cached

    // 3 calls: 2 initial + 1 re-fetch for tenant-a; tenant-b hits cache.
    expect(mockGetMyPermissions).toHaveBeenCalledTimes(3);
  });
});
