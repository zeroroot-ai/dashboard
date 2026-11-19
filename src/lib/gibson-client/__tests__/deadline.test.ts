// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Regression tests for the unary-call deadline interceptor (dashboard#107
 * follow-up).
 *
 * A heap snapshot from the hosted demo run caught 6,244 concurrent, never-
 * completing `ListMyMemberships` calls piling up in ~45s after one Owner
 * sign-in and one /dashboard render, on a single, healthy, "ready"
 * Http2SessionManager. Whatever was slow, the calls had no deadline and so
 * never resolved, rejected, or freed their memory. These tests drive the
 * REAL interceptor chain (`makeClient`, unmocked) against a fake daemon
 * whose handler never returns, the same "backend hangs forever" shape as
 * the incident, and prove:
 *
 *   1. a unary call against a hanging handler is aborted with
 *      Code.DeadlineExceeded instead of hanging forever;
 *   2. a streaming call (Subscribe's shape, `req.stream === true`) is left
 *      completely unbounded, so a real long-lived SSE-backing stream is
 *      never killed by this interceptor.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http2 from 'node:http2';
import type { AddressInfo } from 'node:net';
import { Code, ConnectError } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

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
// The real module, with only assertAuthorized replaced: the transport's
// authz interceptor also reads authzDenial from it.
vi.mock('@/src/lib/auth/assert-authorized', async (importActual) => {
  const actual = await importActual<typeof import('@/src/lib/auth/assert-authorized')>();
  return { ...actual, assertAuthorized: vi.fn(async () => undefined) };
});
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/src/lib/auth/membership', () => ({ getMyMemberships: vi.fn(async () => []) }));

let server: http2.Http2Server;
const sessions = new Set<http2.ServerHttp2Session>();
let baseUrl: string;

beforeAll(async () => {
  // A real ConnectRPC server whose unary handler NEVER resolves, and whose
  // streaming handler yields once then hangs, mirroring "the backend
  // accepted the call but never finishes it" from the incident.
  const { connectNodeAdapter } = await import('@connectrpc/connect-node');
  const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

  const handler = connectNodeAdapter({
    routes: (router) => {
      router.service(DaemonService, {
        listMyMemberships: () => new Promise(() => {}), // never resolves
        // eslint-disable-next-line require-yield
        subscribe: async function* () {
          // Never yields, never returns: a long-lived stream that just sits
          // open, the same shape as Subscribe backing an SSE connection.
          await new Promise(() => {});
        },
      });
    },
  });

  server = http2.createServer(handler);
  // Close every session at the end. A handler that never returns keeps its
  // session open, and close() would wait for it.
  server.on('session', (s) => {
    sessions.add(s);
    s.on('close', () => sessions.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  for (const s of sessions) s.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe('a call with its own longer deadline (gibson#1394)', () => {
  it('stays open past the default 20 seconds, and aborts at its own bound', async () => {
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const { userClient, withCallDeadline } = await import('../transport');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

    let settled = false;
    const callPromise = userClient(DaemonService).listMyMemberships({}, withCallDeadline(60_000));
    const assertion = expect(callPromise).rejects.toThrow(/60000ms/);
    void callPromise.then(
      () => (settled = true),
      () => (settled = true),
    );

    await vi.advanceTimersByTimeAsync(45_000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    const err = await callPromise.catch((e: unknown) => e);
    expect((err as ConnectError).code).toBe(Code.DeadlineExceeded);
  });
});

describe('unary call deadline (dashboard#107 follow-up)', () => {
  it('aborts a hanging unary call with Code.DeadlineExceeded instead of hanging forever', async () => {
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const { userClient } = await import('../transport');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

    const callPromise = userClient(DaemonService).listMyMemberships({});
    const assertion = expect(callPromise).rejects.toThrow(/deadline/i);

    // Advance past the interceptor's deadline. The handler above never
    // resolves on its own, so if the deadline interceptor were absent (or
    // broken) this would hang until the test's own timeout instead.
    await vi.advanceTimersByTimeAsync(30_000);

    await assertion;
    const err = await callPromise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).code).toBe(Code.DeadlineExceeded);
  });

  it('never bounds a streaming call: Subscribe stays open past the unary deadline', async () => {
    process.env['ADMIN_ENVOY_BASE_URL'] = baseUrl;
    const { userClient } = await import('../transport');
    const { DaemonService } = await import('@/src/gen/gibson/daemon/v1/daemon_pb');

    let settled = false;
    let sawEvent = false;
    void (async () => {
      try {
        for await (const _event of userClient(DaemonService).subscribe({})) {
          sawEvent = true;
        }
      } catch {
        // Expected once the test server closes in afterAll: the still-open
        // stream errors out on teardown. The assertions below only care
        // that it did NOT settle from the unary deadline while the test ran.
      } finally {
        settled = true;
      }
    })();

    // Advance WAY past the unary deadline. A streaming call must not be
    // affected by it: if it were, `settled` would flip true here.
    await vi.advanceTimersByTimeAsync(120_000);

    expect(settled).toBe(false);
    expect(sawEvent).toBe(false);
  });
});
