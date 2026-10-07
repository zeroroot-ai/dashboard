// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for the membership resolution module (security-hardening R17,
 * revised 2026-09-29).
 *
 * After the Redis-cutover (dashboard#589 / #579) the dashboard no longer holds
 * a Redis client. The cross-request layer is the per-process verdict cache in
 * membership.ts: one positive verdict per `sub` for MEMBERSHIP_VERDICT_TTL_MS,
 * shared by concurrent readers, never holding an empty result or a failure.
 *
 * Assertions:
 *
 *   1. **Daemon call tracking:** getMyMemberships() reaches the daemon and
 *      returns the expected shape.
 *
 *   2. **Verdict cache:** reads within the TTL cost one daemon call, a page
 *      load's concurrent reads share one in-flight call, an empty result and
 *      a failure are not cached, and the TTL expiry asks the daemon again.
 *
 *   3. **Invalidation:** invalidateMembershipCache(userId) forgets the local
 *      verdict and delegates to the daemon's InvalidateMembershipCache RPC
 *      (fire-and-forget, non-fatal).
 *
 * react.cache() is stubbed to NOT memoize, so each call is a fresh render and
 * only the verdict cache can collapse calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// react.cache must NOT memoize, pass through directly for test determinism.
// ---------------------------------------------------------------------------
vi.mock('react', () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// ---------------------------------------------------------------------------
// Auth.js session, return a stable signed-in user across all tests.
// ---------------------------------------------------------------------------
const TEST_USER_ID = 'zitadel-numeric-sub-12345';
const mockAuth = vi.fn(async () => ({
  user: { id: TEST_USER_ID, name: 'Test User' },
}));
vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}));

// ---------------------------------------------------------------------------
// gibson-client, mock the daemon RPCs.
// ---------------------------------------------------------------------------
const FAKE_LIST_MEMBERSHIPS_RESPONSE = {
  memberships: [
    { tenantId: 't-1', tenantName: 'Tenant One', role: 'admin' },
    { tenantId: 't-2', tenantName: 'Tenant Two', role: 'member' },
  ],
};

const mockListMyMemberships = vi.fn(async () => FAKE_LIST_MEMBERSHIPS_RESPONSE);
const mockInvalidateMembershipCache = vi.fn(async () => ({}));

vi.mock('@/src/lib/gibson-client/transport', () => ({
  userClient: vi.fn(() => ({
    listMyMemberships: mockListMyMemberships,
    invalidateMembershipCache: mockInvalidateMembershipCache,
  })),
}));

// User-token requirer, return a constant placeholder.
vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'fake-token'),
}));

// Logger, silence during tests.
vi.mock('@/src/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Now import the module under test (after all mocks are set up).
// ---------------------------------------------------------------------------
import {
  getMyMemberships,
  invalidateMembershipCache,
  MEMBERSHIP_VERDICT_TTL_MS,
  __clearMembershipVerdictCacheForTests,
  __getDaemonCallCountForTests,
  __resetDaemonCallCountForTests,
} from '../membership';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetDaemonCallCountForTests();
  __clearMembershipVerdictCacheForTests();
  vi.useRealTimers();
  vi.clearAllMocks();
  // Re-attach mocks after clearAllMocks (which resets mock fn call counts
  // but also resets the mock implementations to their default no-op).
  mockListMyMemberships.mockResolvedValue(FAKE_LIST_MEMBERSHIPS_RESPONSE);
  mockInvalidateMembershipCache.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getMyMemberships, basic fetch', () => {
  it('calls the daemon and returns the membership array', async () => {
    const result = await getMyMemberships();
    expect(result).toHaveLength(2);
    expect(__getDaemonCallCountForTests()).toBe(1);
  });

  it('the payload matches the daemon response shape', async () => {
    const result = await getMyMemberships();
    expect(result).toEqual([
      { tenantId: 't-1', tenantName: 'Tenant One', role: 'admin' },
      { tenantId: 't-2', tenantName: 'Tenant Two', role: 'member' },
    ]);
  });

});

describe('getMyMemberships, per-process verdict cache', () => {
  it('reads within the TTL cost one daemon call', async () => {
    await getMyMemberships();
    await getMyMemberships();
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(1);
  });

  it('concurrent reads (one page load) share one in-flight daemon call', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => getMyMemberships()),
    );
    expect(results.every((r) => r.length === 2)).toBe(true);
    expect(__getDaemonCallCountForTests()).toBe(1);
  });

  it('asks the daemon again once the TTL has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    await getMyMemberships();
    vi.setSystemTime(new Date(Date.now() + MEMBERSHIP_VERDICT_TTL_MS - 1));
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(1);
    vi.setSystemTime(new Date(Date.now() + 2));
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(2);
  });

  it('does not cache an empty result, so a new grant shows at once', async () => {
    mockListMyMemberships.mockResolvedValueOnce({ memberships: [] });
    expect(await getMyMemberships()).toEqual([]);
    const after = await getMyMemberships();
    expect(after).toHaveLength(2);
    expect(__getDaemonCallCountForTests()).toBe(2);
  });

  it('does not cache a failure, so the next read tries the daemon again', async () => {
    mockListMyMemberships.mockRejectedValueOnce(new Error('boom'));
    await expect(getMyMemberships()).rejects.toThrow();
    expect(await getMyMemberships()).toHaveLength(2);
    expect(__getDaemonCallCountForTests()).toBe(2);
  });

  it('keeps one verdict per user, never across users', async () => {
    await getMyMemberships();
    mockAuth.mockResolvedValueOnce({ user: { id: 'another-sub', name: 'Other' } });
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(2);
  });
});

describe('invalidateMembershipCache, delegation to daemon', () => {
  it('forgets the local verdict, so the next read asks the daemon', async () => {
    await getMyMemberships();
    await invalidateMembershipCache(TEST_USER_ID);
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(2);
  });

  it('delegates to the daemon InvalidateMembershipCache RPC', async () => {
    await invalidateMembershipCache(TEST_USER_ID);
    expect(mockInvalidateMembershipCache).toHaveBeenCalledOnce();
    const req = (mockInvalidateMembershipCache.mock.calls[0] as unknown[])[0] as { userId: string };
    expect(req.userId).toBe(TEST_USER_ID);
  });

  it('is a no-op for an empty user id (no RPC call)', async () => {
    await invalidateMembershipCache('');
    expect(mockInvalidateMembershipCache).not.toHaveBeenCalled();
    expect(__getDaemonCallCountForTests()).toBe(0);
  });

  it('does not throw when the daemon RPC fails (non-fatal)', async () => {
    mockInvalidateMembershipCache.mockRejectedValue(new Error('daemon unreachable'));
    await expect(invalidateMembershipCache(TEST_USER_ID)).resolves.toBeUndefined();
  });
});
