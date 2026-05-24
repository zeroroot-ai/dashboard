/**
 * Tests for the gibson-client Connect-ES transport:
 * - Injects Authorization: Bearer on every request
 * - Removes all x-gibson-* header injection
 * - Fails closed (throws ConnectError/Unauthenticated) when no access token
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Mocks must be declared before the module under test is imported.
// ---------------------------------------------------------------------------

const mockAuthResult: { accessToken?: string } = {};

vi.mock('@/auth', () => ({
  auth: vi.fn(async () =>
    mockAuthResult.accessToken ? { accessToken: mockAuthResult.accessToken } : null,
  ),
}));

// Capture the interceptor injected into createGrpcTransport so we can
// exercise the header-mutation logic without a live gRPC connection.
type Interceptor = (next: (req: MockReq) => Promise<unknown>) => (req: MockReq) => Promise<unknown>;

interface MockReq {
  header: Headers;
}

let capturedInterceptors: Interceptor[] = [];

vi.mock('@connectrpc/connect-node', () => ({
  createGrpcTransport: vi.fn((opts: { interceptors?: Interceptor[] }) => {
    capturedInterceptors = opts.interceptors ?? [];
    return { _tag: 'mock-transport' };
  }),
}));

vi.mock('@connectrpc/connect', async (importActual) => {
  const actual = await importActual<typeof import('@connectrpc/connect')>();
  return {
    ...actual,
    createClient: vi.fn(() => ({ _tag: 'mock-client' })),
  };
});

// Stub out proto-generated service descriptors.
vi.mock('@/src/gen/gibson/daemon/v1/daemon_pb', () => ({ DaemonService: {} }));
vi.mock('@/src/gen/gibson/tenant/v1/tenant_pb', () => ({ TenantService: {} }));

// Stub out server-config. `gibsonDaemonUrl` was removed in
// spec headline-feature-completion R11; the field below is left here so
// any unrelated test assertion that may consult `serverConfig` still
// resolves an object — but no module under test reads it.
vi.mock('@/src/lib/config', () => ({
  serverConfig: { gibsonPlatformPublicUrl: 'http://envoy.test:8080' },
}));

// Stub out the GraphService client used by the analytics helpers.
vi.mock('@/src/gen/gibson/graph/v1/graph_pb', () => ({
  GraphService: {},
  FindingCountGroupBy: { SEVERITY: 1, CATEGORY: 2, FINDING_COUNT_GROUP_BY_UNSPECIFIED: 0 },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run the captured interceptor chain against a synthetic request and return
 * the headers that were set.
 */
async function runInterceptors(existingHeaders?: Record<string, string>): Promise<Headers> {
  const reqHeaders = new Headers(existingHeaders);
  const mockReq: MockReq = { header: reqHeaders };

  // Build the terminal "next" handler (identity — just returns a resolved promise).
  const terminal = async (req: MockReq) => req;

  // Compose the interceptor stack right-to-left (Connect-ES convention).
  const composed = capturedInterceptors.reduceRight(
    (next: (req: MockReq) => Promise<unknown>, interceptor) => interceptor(next),
    terminal,
  );

  await composed(mockReq);
  return reqHeaders;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('gibson-client transport interceptor', () => {
  beforeEach(() => {
    capturedInterceptors = [];
    mockAuthResult.accessToken = undefined;
    vi.clearAllMocks();
  });

  it('sets Authorization: Bearer when a valid access token is in the session', async () => {
    mockAuthResult.accessToken = 'zt-access-token-abc123';

    // Importing the module triggers getTransport indirectly; we call a public
    // function to warm up the module and capture interceptors.
    const { getStatus } = await import('@/src/lib/gibson-client');

    // getStatus calls getClient() which calls resolveAccessToken() + getTransport().
    // Swallow the error from the mock client (it returns a stub, not a real proto).
    await getStatus().catch(() => {});

    const headers = await runInterceptors();
    expect(headers.get('Authorization')).toBe('Bearer zt-access-token-abc123');
  });

  it('does NOT inject x-gibson-user-id', async () => {
    mockAuthResult.accessToken = 'zt-token-xyz';

    const { getStatus } = await import('@/src/lib/gibson-client');
    await getStatus().catch(() => {});

    const headers = await runInterceptors();
    expect(headers.get('x-gibson-user-id')).toBeNull();
  });

  it('does NOT inject x-gibson-tenant', async () => {
    mockAuthResult.accessToken = 'zt-token-xyz';

    const { listMissions } = await import('@/src/lib/gibson-client');
    await listMissions(false, 10, 'user-1', 'tenant-1').catch(() => {});

    const headers = await runInterceptors();
    expect(headers.get('x-gibson-tenant')).toBeNull();
  });

  it('fails closed with ConnectError Unauthenticated when session has no token', async () => {
    mockAuthResult.accessToken = undefined; // no token

    const { getStatus } = await import('@/src/lib/gibson-client');

    await expect(getStatus()).rejects.toSatisfy((err: unknown) => {
      return err instanceof ConnectError && err.code === Code.Unauthenticated;
    });
  });

  it('fails closed with ConnectError Unauthenticated when session is null', async () => {
    // auth() returns null (no session)
    mockAuthResult.accessToken = undefined;

    const { ping } = await import('@/src/lib/gibson-client');
    await expect(ping()).rejects.toSatisfy((err: unknown) => {
      return err instanceof ConnectError && err.code === Code.Unauthenticated;
    });
  });
});
