// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Regression tests for dashboard#107 / #108 (heap grows until the pod OOMs)
 * and the follow-up in this PR: the "one session manager" guarantee #108
 * describes does not survive Next.js compiling `transport.ts` into more than
 * one bundle.
 *
 * Evidence for the follow-up bug (see the PR description for the full
 * writeup): the compiled standalone output contains THREE independent
 * copies of this module's code, each with its own `sharedSession` /
 * `spiffeWarmedUp` / `spiffeFallbackLogged` state, because
 * `output: "standalone"` compiles middleware.ts, and every server
 * chunk that (transitively) imports gibson-client, into separate bundles:
 *
 *   grep -rl "SPIFFE Workload API socket not present" .next/server
 *     .next/server/chunks/7371.js
 *     .next/server/chunks/9706.js
 *     .next/server/middleware.js
 *
 * A plain module-scope `let sharedSession` is duplicated once per bundle, so
 * the fix landed in #108 ("all transports share ONE session manager") only
 * holds within a single bundle. Three bundles means up to three live HTTP/2
 * sessions and TLS contexts to Envoy per pod instead of one, and it is why
 * the "SPIFFE Workload API socket not present" warning is observed logged
 * twice in a single pod's logs (dashboard-heap-leak repro session, 2026-09).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';

vi.mock('server-only', () => ({}));

// Token + tenant sourcing stubs, same as transport.test.ts, these tests are
// about the transport/session machinery, not token minting.
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
vi.mock('@/src/lib/auth/assert-authorized', () => ({
  assertAuthorized: vi.fn(async () => undefined),
}));

let server: http2.Http2Server;
let baseUrl: string;

beforeAll(async () => {
  // Real ConnectRPC server, plaintext HTTP/2 (h2c), answering
  // ListMyMemberships with one membership, the exact RPC `getMyMemberships()`
  // fires on every authenticated request.
  const { connectNodeAdapter } = await import('@connectrpc/connect-node');
  const { create } = await import('@bufbuild/protobuf');
  const { DaemonService, ListMyMembershipsResponseSchema } = await import(
    '@/src/gen/gibson/daemon/v1/daemon_pb'
  );

  const handler = connectNodeAdapter({
    routes: (router) => {
      router.service(DaemonService, {
        listMyMemberships: () =>
          create(ListMyMembershipsResponseSchema, {
            memberships: [
              { tenantId: 't1', tenantName: 'Tenant One', role: 'owner' },
            ],
          }),
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

afterEach(() => {
  vi.resetModules();
});

describe('transport RPC loop does not leak (dashboard#107 regression)', () => {
  it('heap growth after 2000 real RPCs stays within a small, bounded envelope', async () => {
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const { userClient } = await import('../transport');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

    // Warm up: let JIT/module-init one-time costs happen before baselining.
    for (let i = 0; i < 100; i += 1) {
      await userClient(DaemonService).listMyMemberships({});
    }

    // `writeHeapSnapshot()` forces a full (multi-pass) GC as part of
    // serializing the snapshot, so this works in every environment without
    // needing the test runner invoked with `--expose-gc`. Writing to
    // `/dev/null` gets the forced GC without leaving a file behind, and
    // without the cost of actually serializing a heap graph anywhere durable.
    const v8 = await import('node:v8');
    const forceGc = (): void => {
      v8.writeHeapSnapshot('/dev/null');
    };
    forceGc();
    const before = process.memoryUsage().heapUsed;

    const ITERATIONS = 2000;
    for (let i = 0; i < ITERATIONS; i += 1) {
      await userClient(DaemonService).listMyMemberships({});
    }

    forceGc();
    const after = process.memoryUsage().heapUsed;
    const growthPerCall = (after - before) / ITERATIONS;

    // A shared, well-behaved transport does a handful of allocations per
    // call (headers, promises) that GC reclaims. This budget is generous
    // (2 KB/call) precisely so it fails on a real retained-object leak (a
    // Transport, Client, or session held onto per call) rather than on
    // GC-timing noise: a real per-call leak (a fresh Http2SessionManager,
    // the #107 bug) costs kilobytes of TLS/session state per call, not
    // bytes.
    expect(growthPerCall).toBeLessThan(2_000);
  }, 30_000);
});

describe('one session manager survives module duplication across bundles (dashboard#107 follow-up)', () => {
  it('two independently-evaluated module instances resolve to the same Http2SessionManager', async () => {
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const first = await import('../transport');
    const firstManager = first.sessionManagerFor(undefined);

    // `next build` with `output: "standalone"` compiles this file into a
    // SEPARATE bundle per entry point that imports it (middleware.js, and
    // every server/route chunk that transitively imports gibson-client).
    // Each bundle gets its own top-level module evaluation. `vi.resetModules()`
    // forces the same re-evaluation here: before this fix, `sharedSession`
    // was a plain module-scope `let`, so the "second bundle" built its own
    // Http2SessionManager, and its own live HTTP/2 + TLS session to Envoy,
    // silently multiplying the "one session for the whole process" guarantee
    // #108 was written to establish.
    vi.resetModules();
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const second = await import('../transport');
    const secondManager = second.sessionManagerFor(undefined);

    expect(secondManager).toBe(firstManager);
  });
});
