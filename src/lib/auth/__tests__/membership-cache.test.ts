/**
 * Unit tests for the cross-request membership cache (security-hardening R17).
 *
 * Two assertions:
 *
 *   1. **Request-collapse:** 100 sequential `getMyMemberships()` invocations
 *      for one user → exactly ONE daemon RPC. The other 99 read from the
 *      Redis cache. Counts are tracked via the test-only helpers
 *      `__getDaemonCallCountForTests` / `__resetDaemonCallCountForTests`.
 *
 *   2. **Invalidation:** an explicit `invalidateMembershipCache(userId)` call
 *      drops the cache entry, so the next read re-fetches from the daemon.
 *      This simulates what happens when an FGA-write event fires in
 *      cluster (the daemon-Go agent is the producer; this agent's wiring
 *      is downstream of that work).
 *
 * The Redis layer is stubbed by mocking `@/src/lib/redis-store` with an
 * in-memory Map — we don't want to depend on a live Redis for unit tests.
 * The TTL is left at the default; tests don't exercise expiry, only
 * explicit invalidation.
 *
 * react.cache() is also stubbed to NOT memoize — without this, only the
 * first call within the test would hit our Redis-mock layer (vitest runs
 * each test in a fresh "render"-like scope, but the cache function is
 * created at module load time, so the memoization survives across calls).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory Redis mock — the cache layer reads/writes via these helpers.
// ---------------------------------------------------------------------------
const redisStore = new Map<string, unknown>();

vi.mock('@/src/lib/redis-store', () => ({
  getJSON: vi.fn(async (key: string) => {
    return redisStore.has(key) ? (redisStore.get(key) as unknown) : null;
  }),
  setJSON: vi.fn(async (key: string, value: unknown) => {
    redisStore.set(key, value);
    return true;
  }),
  delKey: vi.fn(async (key: string) => {
    redisStore.delete(key);
    return true;
  }),
}));

// ---------------------------------------------------------------------------
// react.cache must NOT memoize — pass through directly so we can control
// per-call behaviour from the Redis-mock layer.
// ---------------------------------------------------------------------------
vi.mock('react', () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// ---------------------------------------------------------------------------
// Auth.js session — return a stable signed-in user across all tests.
// ---------------------------------------------------------------------------
const TEST_USER_ID = 'zitadel-numeric-sub-12345';
vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: TEST_USER_ID, name: 'Test User' },
  })),
}));

// ---------------------------------------------------------------------------
// gibson-client — mock the daemon RPC. Each call returns a fixed response;
// we count invocations via the daemon-call counter inside membership.ts.
// ---------------------------------------------------------------------------
const FAKE_LIST_MEMBERSHIPS_RESPONSE = {
  memberships: [
    { tenantId: 't-1', tenantName: 'Tenant One', role: 'admin' },
    { tenantId: 't-2', tenantName: 'Tenant Two', role: 'member' },
  ],
};
vi.mock('@/src/lib/gibson-client', () => ({
  makeClient: vi.fn(() => ({
    listMyMemberships: vi.fn(async () => FAKE_LIST_MEMBERSHIPS_RESPONSE),
  })),
}));

// User-token requirer — return a constant placeholder; not asserted.
vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'fake-token'),
}));

// Test-fixture fault injection — disabled.
vi.mock('@/src/lib/test-fixtures/fault-injection', () => ({
  getFaultMode: () => undefined,
}));

// Logger — silence during tests.
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
  redisStore.clear();
  __resetDaemonCallCountForTests();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('R17 membership cache — request collapse', () => {
  it('100 sequential reads collapse to ONE daemon RPC', async () => {
    // First read: Redis miss → daemon call → write to Redis.
    const first = await getMyMemberships();
    expect(first).toHaveLength(2);
    expect(__getDaemonCallCountForTests()).toBe(1);

    // 99 subsequent reads should ALL hit the Redis cache.
    for (let i = 0; i < 99; i++) {
      const result = await getMyMemberships();
      expect(result).toHaveLength(2);
    }

    // Daemon should have been called exactly once across all 100 reads.
    expect(__getDaemonCallCountForTests()).toBe(1);
  });

  it('the cached payload matches the daemon response shape', async () => {
    const result = await getMyMemberships();
    expect(result).toEqual([
      { tenantId: 't-1', tenantName: 'Tenant One', role: 'admin' },
      { tenantId: 't-2', tenantName: 'Tenant Two', role: 'member' },
    ]);
  });
});

describe('R17 membership cache — invalidation', () => {
  it('invalidateMembershipCache forces a re-fetch on the next read', async () => {
    // Prime the cache.
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(1);

    // Read again — cache hit.
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(1);

    // Simulate an FGA-write event: invalidate the user's cache.
    await invalidateMembershipCache(TEST_USER_ID);

    // Next read must hit the daemon again.
    await getMyMemberships();
    expect(__getDaemonCallCountForTests()).toBe(2);
  });

  it('invalidateMembershipCache is a no-op for an unknown user id', async () => {
    await invalidateMembershipCache('not-a-real-user');
    // Sanity: the call did not throw and the daemon was not touched.
    expect(__getDaemonCallCountForTests()).toBe(0);
  });

  it('invalidateMembershipCache with empty string is a no-op', async () => {
    await invalidateMembershipCache('');
    expect(__getDaemonCallCountForTests()).toBe(0);
  });
});

describe('R17 membership cache — Redis unavailability degrades to no-cache', () => {
  it('falls through to the daemon on every read when Redis writes fail silently', async () => {
    // Reconfigure the redis-store mock to return null on every read AND
    // refuse writes. This is the dev-mode failure mode: the pod has no
    // Redis side-car, so the cache is effectively disabled.
    const redisStoreModule = await import('@/src/lib/redis-store');
    vi.mocked(redisStoreModule.getJSON).mockImplementation(async () => null);
    vi.mocked(redisStoreModule.setJSON).mockImplementation(async () => false);

    await getMyMemberships();
    await getMyMemberships();
    await getMyMemberships();

    // Three reads, three daemon calls — no cache collapse without Redis.
    // The per-render react.cache() layer would collapse these in a real
    // request, but we mocked it out for this test.
    expect(__getDaemonCallCountForTests()).toBe(3);
  });
});
