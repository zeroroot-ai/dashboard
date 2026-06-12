/**
 * Unit tests for the membership resolution module (security-hardening R17).
 *
 * After the Redis-cutover (dashboard#589 / #579) the dashboard no longer holds
 * a Redis client. The cross-request cache is now managed by the daemon.
 * The dashboard side retains only per-render memoization via react.cache().
 *
 * Two assertions remain:
 *
 *   1. **Daemon call tracking:** getMyMemberships() reaches the daemon and
 *      returns the expected shape.
 *
 *   2. **Invalidation:** invalidateMembershipCache(userId) delegates to the
 *      daemon's InvalidateMembershipCache RPC (fire-and-forget, non-fatal).
 *
 * react.cache() is still stubbed to NOT memoize, each test call is
 * treated as a fresh render so we can assert per-call daemon counts.
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
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: TEST_USER_ID, name: 'Test User' },
  })),
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

vi.mock('@/src/lib/gibson-client', () => ({
  makeClient: vi.fn(() => ({
    listMyMemberships: mockListMyMemberships,
    invalidateMembershipCache: mockInvalidateMembershipCache,
  })),
}));

// User-token requirer, return a constant placeholder.
vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'fake-token'),
}));

// Test-fixture fault injection, disabled.
vi.mock('@/src/lib/test-fixtures/fault-injection', () => ({
  getFaultMode: () => undefined,
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
  __getDaemonCallCountForTests,
  __resetDaemonCallCountForTests,
} from '../membership';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  __resetDaemonCallCountForTests();
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

  it('each read hits the daemon (no cross-request cache on the dashboard side)', async () => {
    await getMyMemberships();
    await getMyMemberships();
    await getMyMemberships();
    // Dashboard no longer has a Redis cross-request cache.
    // Each call reaches the daemon (which applies its own server-side cache).
    expect(__getDaemonCallCountForTests()).toBe(3);
  });
});

describe('invalidateMembershipCache, delegation to daemon', () => {
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
