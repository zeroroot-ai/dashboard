/**
 * Unit tests for the single module-private daemon transport
 * (src/lib/gibson-client/transport.ts, dashboard#814 / E9).
 *
 * Verifies the auth-interceptor header contract for each sanctioned wrapper:
 *   - userClient injects Authorization + x-gibson-tenant (active-tenant cookie)
 *   - serviceClient injects Authorization + the explicit tenant header
 *   - bootstrapClient injects Authorization but NO x-gibson-tenant (empty
 *     tenant, the membership-bootstrap boundary)
 *
 * The transport itself (createGrpcTransport) is mocked so the interceptor can
 * be exercised without a live gRPC connection, mirroring the pattern in
 * src/lib/__tests__/gibson-client.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

type Interceptor = (
  next: (req: MockReq) => Promise<unknown>,
) => (req: MockReq) => Promise<unknown>;

interface MockReq {
  header: Headers;
  method?: { name?: string };
  service?: { typeName?: string };
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

// Token + tenant sourcing stubs.
vi.mock('@/src/lib/auth/user-token', () => ({
  requireUserToken: vi.fn(async () => 'user-token'),
}));
vi.mock('@/src/lib/auth/service-token', () => ({
  getServiceToken: vi.fn(async () => 'service-token'),
  invalidateServiceToken: vi.fn(),
}));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  getActiveTenant: vi.fn(async () => 'tenant-from-cookie'),
  unsafeTenantId: (v: string) => v,
}));

// Metrics, no-op counters.
vi.mock('@/src/lib/metrics/gibson-admin', () => ({
  adminRpcTotal: { inc: vi.fn() },
  adminEnvoyUpstreamErrorsTotal: { inc: vi.fn() },
}));

// Per-RPC authz bake-in (dashboard#848). Stubbed to a no-op pass here so the
// header-contract tests exercise the auth interceptor in isolation; a dedicated
// describe-block below asserts WHICH wrapper runs it and with which method.
const mockAssertAuthorized = vi.fn(async (_method: string): Promise<void> => {});
vi.mock('@/src/lib/auth/assert-authorized', () => ({
  assertAuthorized: (method: string) => mockAssertAuthorized(method),
}));

const FAKE_SERVICE = {} as never;

/**
 * Drive the captured interceptor chain against a synthetic request and return
 * the headers the auth interceptor set.
 */
async function runInterceptors(): Promise<Headers> {
  const reqHeaders = new Headers();
  const mockReq: MockReq = {
    header: reqHeaders,
    method: { name: 'Test' },
    service: { typeName: 'gibson.test.v1.TestService' },
  };
  const terminal = async (req: MockReq) => req;
  const composed = capturedInterceptors.reduceRight(
    (next: (req: MockReq) => Promise<unknown>, interceptor) => interceptor(next),
    terminal,
  );
  await composed(mockReq);
  return reqHeaders;
}

describe('single daemon transport wrappers', () => {
  beforeEach(() => {
    capturedInterceptors = [];
    vi.clearAllMocks();
  });

  it('does not export the raw transport factory makeClient', async () => {
    const mod = await import('../transport');
    expect('makeClient' in mod).toBe(false);
    expect(typeof mod.userClient).toBe('function');
    expect(typeof mod.serviceClient).toBe('function');
    expect(typeof mod.bootstrapClient).toBe('function');
  });

  it('userClient forwards bearer + active-tenant header', async () => {
    const { userClient } = await import('../transport');
    userClient(FAKE_SERVICE);
    const headers = await runInterceptors();
    expect(headers.get('Authorization')).toBe('Bearer user-token');
    expect(headers.get('x-gibson-tenant')).toBe('tenant-from-cookie');
  });

  it('serviceClient forwards bearer + the explicit tenant header', async () => {
    const { serviceClient } = await import('../transport');
    serviceClient(FAKE_SERVICE, 'explicit-tenant');
    const headers = await runInterceptors();
    expect(headers.get('Authorization')).toBe('Bearer service-token');
    expect(headers.get('x-gibson-tenant')).toBe('explicit-tenant');
  });

  it('bootstrapClient forwards bearer but NO x-gibson-tenant (empty tenant)', async () => {
    const { bootstrapClient } = await import('../transport');
    bootstrapClient(FAKE_SERVICE);
    const headers = await runInterceptors();
    expect(headers.get('Authorization')).toBe('Bearer user-token');
    expect(headers.has('x-gibson-tenant')).toBe(false);
  });
});

describe('per-RPC authz bake-in (dashboard#848)', () => {
  beforeEach(() => {
    capturedInterceptors = [];
    vi.clearAllMocks();
  });

  it('userClient runs assertAuthorized with the descriptor-derived method path', async () => {
    const { userClient } = await import('../transport');
    userClient(FAKE_SERVICE);
    await runInterceptors();
    expect(mockAssertAuthorized).toHaveBeenCalledTimes(1);
    expect(mockAssertAuthorized).toHaveBeenCalledWith(
      '/gibson.test.v1.TestService/Test',
    );
  });

  it('serviceClient does NOT run assertAuthorized (SERVICE-acting, no user)', async () => {
    const { serviceClient } = await import('../transport');
    serviceClient(FAKE_SERVICE, 'explicit-tenant');
    await runInterceptors();
    expect(mockAssertAuthorized).not.toHaveBeenCalled();
  });

  it('bootstrapClient does NOT run assertAuthorized (pre-tenant bootstrap)', async () => {
    const { bootstrapClient } = await import('../transport');
    bootstrapClient(FAKE_SERVICE);
    await runInterceptors();
    expect(mockAssertAuthorized).not.toHaveBeenCalled();
  });

  it('a denial from assertAuthorized rejects the RPC before it reaches the wire', async () => {
    mockAssertAuthorized.mockRejectedValueOnce(new Error('denied'));
    const { userClient } = await import('../transport');
    userClient(FAKE_SERVICE);
    await expect(runInterceptors()).rejects.toThrow('denied');
  });
});
