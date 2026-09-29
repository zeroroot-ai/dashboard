// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * A denial from the transport's authz interceptor, read the way a server
 * action reads it: through the REAL connect-es client, not by driving the
 * interceptor chain by hand.
 *
 * transport.test.ts mocks `createClient` and calls the captured interceptors
 * directly, so it never sees what connect-es does to an error an interceptor
 * throws: `runUnaryCall` passes it through `ConnectError.from`, which gives a
 * plain Error the code Unknown and keeps it only as `cause`. Measured
 * 2026-09-29 on staging: `instanceof AuthzDeniedError` was false on that
 * shape, `permissionDeniedResult` returned null, and a member who pressed
 * "Enable" on a connector saw the internal-error page.
 *
 * This test builds a real client over an in-memory router transport with the
 * same interceptors `userClient` installs, denies the call in
 * `assertAuthorized`, and asserts what the caller receives.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Code, ConnectError, createClient, createRouterTransport } from '@connectrpc/connect';
import type { Interceptor } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

let capturedInterceptors: Interceptor[] = [];

vi.mock('@connectrpc/connect-node', () => ({
  createGrpcTransport: vi.fn((opts: { interceptors?: Interceptor[] }) => {
    capturedInterceptors = opts.interceptors ?? [];
    return { _tag: 'mock-transport' };
  }),
  Http2SessionManager: class {
    abort = vi.fn();
  },
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
// assert-authorized's real dependencies (the session, memberships) are not
// under test; the denial itself is.
vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/src/lib/auth/membership', () => ({ getMyMemberships: vi.fn(async () => []) }));

const mockAssertAuthorized = vi.fn(async (_method: string): Promise<void> => {});
vi.mock('@/src/lib/auth/assert-authorized', async (importActual) => {
  const actual = await importActual<typeof import('@/src/lib/auth/assert-authorized')>();
  return {
    ...actual,
    assertAuthorized: (method: string) => mockAssertAuthorized(method),
  };
});

const METHOD = '/gibson.tenant.v1.ConnectorAuthService/StartConnectorAuthorization';

/** A real client over an in-memory transport that runs userClient's interceptors. */
async function realClientWithUserInterceptors() {
  const { userClient } = await import('../transport');
  const { ConnectorAuthService } = await import('@/src/gen/gibson/tenant/v1/connector_auth_pb');
  userClient(ConnectorAuthService); // captures the interceptor chain
  expect(capturedInterceptors.length).toBeGreaterThan(0);
  const transport = createRouterTransport(
    (router) => {
      router.service(ConnectorAuthService, {
        startConnectorAuthorization: () => ({ authorizeUrl: 'https://vendor.example/authorize' }),
      });
    },
    { transport: { interceptors: capturedInterceptors } },
  );
  return createClient(ConnectorAuthService, transport);
}

describe('an authz denial through the real connect-es client', () => {
  beforeEach(() => {
    capturedInterceptors = [];
    vi.clearAllMocks();
  });

  it('reaches the caller as a ConnectError with code PermissionDenied and the AuthzDeniedError as cause', async () => {
    const { AuthzDeniedError } = await import('@/src/lib/auth/assert-authorized');
    mockAssertAuthorized.mockRejectedValueOnce(new AuthzDeniedError(METHOD, 'relation-not-met'));
    const client = await realClientWithUserInterceptors();

    let caught: unknown;
    try {
      await client.startConnectorAuthorization({});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConnectError);
    const ce = caught as ConnectError;
    expect(ce.code).toBe(Code.PermissionDenied);
    expect(ce.cause).toBeInstanceOf(AuthzDeniedError);
    expect((ce.cause as InstanceType<typeof AuthzDeniedError>).reason).toBe('relation-not-met');
    expect(mockAssertAuthorized).toHaveBeenCalledWith(METHOD);
  });

  it('is read as a denial by permissionDeniedResult and authzDenial, and classified permission_denied by serverActionError', async () => {
    const { AuthzDeniedError, authzDenial, permissionDeniedResult } = await import(
      '@/src/lib/auth/assert-authorized'
    );
    const { serverActionError } = await import('@/src/lib/errors/server-action-error');
    mockAssertAuthorized.mockRejectedValueOnce(new AuthzDeniedError(METHOD, 'relation-not-met'));
    const client = await realClientWithUserInterceptors();

    const caught = await client.startConnectorAuthorization({}).then(
      () => null,
      (err: unknown) => err,
    );
    expect(caught).not.toBeNull();
    expect(authzDenial(caught)).toBeInstanceOf(AuthzDeniedError);
    expect(permissionDeniedResult(caught)).toEqual({
      ok: false,
      error: 'Permission denied',
      code: 'permission_denied',
    });
    // A caller that skipped permissionDeniedResult still gets the right class.
    expect(serverActionError(caught, { action: 'test' }).code).toBe('permission_denied');
  });

  it('lets an allowed call through to the service', async () => {
    const client = await realClientWithUserInterceptors();
    const res = await client.startConnectorAuthorization({});
    expect(res.authorizeUrl).toBe('https://vendor.example/authorize');
  });

  it('authzDenial reads both shapes and nothing else', async () => {
    const { AuthzDeniedError, authzDenial } = await import('@/src/lib/auth/assert-authorized');
    const direct = new AuthzDeniedError(METHOD, 'not-a-member');
    expect(authzDenial(direct)).toBe(direct);
    // What connect-es does to a plain throw from an interceptor.
    const wrapped = ConnectError.from(direct);
    expect(wrapped.code).toBe(Code.Unknown);
    expect(authzDenial(wrapped)).toBe(direct);
    expect(authzDenial(new ConnectError('nope', Code.PermissionDenied))).toBeNull();
    expect(authzDenial(new Error('assertAuthorized: relation-not-met'))).toBeNull();
    expect(authzDenial(null)).toBeNull();
  });
});
