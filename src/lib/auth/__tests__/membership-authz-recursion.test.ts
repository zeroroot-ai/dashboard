// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Regression test for the dashboard#107 root cause: infinite async
 * recursion between `assertAuthorized` and `getMyMemberships`.
 *
 * `src/gen/authz/registry.ts` registers `ListMyMemberships` with
 * `unauthenticated: false` (a user token IS required at the wire level,
 * which is correct). Before this fix, `membershipsClient()` built its
 * client with the default `userClient(DaemonService)` (authz enforced),
 * so every `ListMyMemberships` call ran through the dashboard's own
 * `authzInterceptor` -> `assertAuthorized("ListMyMemberships")` -> which,
 * seeing a NOT-unauthenticated entry, called `getMyMemberships()` to
 * resolve the caller's membership -> which called `ListMyMemberships`
 * again -> forever. A hosted heap snapshot caught this directly: one
 * Owner sign-in and one /dashboard render left 6,244 concurrent,
 * never-completing `ListMyMemberships` calls, none of which had reached
 * the wire (the interceptor chain never got past `assertAuthorized`).
 *
 * This test uses the REAL generated `AuthRegistry`, the REAL
 * `assertAuthorized` logic, and the REAL `membershipsClient()` /
 * `userClient()` wiring, against a real (local, in-process) ConnectRPC
 * daemon, so it exercises the exact call chain the incident hit.
 *
 * Safety note: an unfixed dashboard recurses WITHOUT bound (that is the
 * bug), entirely through promise continuations with no real I/O and no
 * macrotask yield anywhere in the loop (confirmed by the incident's own
 * heap snapshot: almost none of 6,244 pending calls had opened an HTTP/2
 * stream). Letting that play out for real inside a test process starves
 * the event loop's timer phase, so neither a `Promise.race` against a
 * real `setTimeout` nor vitest's own per-test timeout can reliably
 * observe or stop it. `assertAuthorized` is instead wrapped with a small
 * recursion cap that throws once the recursion proves itself (more than
 * 3 re-entries into its own RPC), which unwinds the call chain cleanly
 * via normal promise rejection instead of running away. The cap never
 * activates on fixed code, since fixed code never re-enters at all.
 *
 * Implementation note: every call `assertAuthorized` receives is recorded
 * into a plain module-scope array (`assertAuthorizedCalls`) from inside
 * the mock factory, rather than re-importing the mocked module a second
 * time from the test body to read `vi.fn().mock.calls`. A second dynamic
 * `import('.../assert-authorized')` alongside the one `authzInterceptor`
 * performs internally was observed to make the mock stop intercepting
 * that second call site's resolution, silently falling through to the
 * real, uncapped implementation (and hanging). The array sidesteps that
 * entirely: it needs no second import.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';

const LIST_MY_MEMBERSHIPS_METHOD = '/gibson.daemon.v1.DaemonService/ListMyMemberships';
const TEST_USER_ID = 'zitadel-numeric-sub-12345';
const TEST_TENANT_ID = 't-1';
const MAX_TEST_RECURSION = 3;

vi.mock('server-only', () => ({}));

// react.cache() does not dedupe outside a real render (this is part of why
// dashboard#107 recursed instead of collapsing to one call), so passing it
// through directly here matches production behavior for this call chain.
vi.mock('react', () => ({
  cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

// The recursion-safety wrapper described above. Everything except the cap
// is the REAL `assertAuthorized`, including the REAL generated AuthRegistry
// it reads (that module is not mocked anywhere in this file).
let recursionCount = 0;
const assertAuthorizedCalls: string[] = [];
vi.mock('@/src/lib/auth/assert-authorized', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/auth/assert-authorized')>();
  const guarded = vi.fn(async (method: string) => {
    assertAuthorizedCalls.push(method);
    if (method === LIST_MY_MEMBERSHIPS_METHOD) {
      recursionCount += 1;
      if (recursionCount > MAX_TEST_RECURSION) {
        throw new Error(
          `test safety valve: assertAuthorized(${method}) recursed more than ` +
            `${MAX_TEST_RECURSION} times without reaching the daemon ` +
            '(dashboard#107 regression: the membership bootstrap re-entered ' +
            'its own authz check)',
        );
      }
    }
    return actual.assertAuthorized(method);
  });
  return { ...actual, assertAuthorized: guarded };
});

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({
    user: { id: TEST_USER_ID, name: 'Test User' },
    tenantId: TEST_TENANT_ID,
  })),
}));

vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'user-token'),
}));
vi.mock('@/src/lib/auth/service-token', () => ({
  getServiceToken: vi.fn(async () => 'service-token'),
  invalidateServiceToken: vi.fn(),
}));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  unsafeTenantId: (v: string) => v,
}));
vi.mock('@/src/lib/metrics/gibson-admin', () => ({
  adminRpcTotal: { inc: vi.fn() },
  adminEnvoyUpstreamErrorsTotal: { inc: vi.fn() },
}));
vi.mock('@/src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

let server: http2.Http2Server;
let baseUrl: string;
let listMyMembershipsCallCount = 0;

beforeAll(async () => {
  const { connectNodeAdapter } = await import('@connectrpc/connect-node');
  const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

  const handler = connectNodeAdapter({
    routes: (router) => {
      router.service(DaemonService, {
        listMyMemberships: () => {
          listMyMembershipsCallCount += 1;
          return {
            memberships: [{ tenantId: TEST_TENANT_ID, tenantName: 'Tenant One', role: 'admin' }],
          };
        },
      });
    },
  });

  server = http2.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  recursionCount = 0;
  assertAuthorizedCalls.length = 0;
  listMyMembershipsCallCount = 0;
  process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
});

afterEach(() => {
  vi.resetModules();
});

describe('getMyMemberships does not recurse through assertAuthorized (dashboard#107)', () => {
  it('makes exactly one ListMyMemberships RPC and never re-enters assertAuthorized', async () => {
    const { getMyMemberships } = await import('@/src/lib/auth/membership');

    let result: unknown;
    let caught: unknown;
    try {
      result = await getMyMemberships();
    } catch (err) {
      caught = err;
    }

    // The membership bootstrap must never gate itself on membership: this
    // is the dashboard#107 root cause, and it must never happen again
    // regardless of how the call above settled.
    const recursedIntoSelf = assertAuthorizedCalls.includes(LIST_MY_MEMBERSHIPS_METHOD);
    expect(recursedIntoSelf).toBe(false);

    expect(caught).toBeUndefined();
    expect(result).toEqual([{ tenantId: TEST_TENANT_ID, tenantName: 'Tenant One', role: 'admin' }]);
    expect(listMyMembershipsCallCount).toBe(1);
  });
});
