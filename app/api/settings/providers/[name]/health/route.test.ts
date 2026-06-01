/**
 * Tests for GET /api/settings/providers/[name]/health
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy path returns the daemon health status
 * - ConnectErrors are translated to correct HTTP status codes
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(),
  activeTenantApiResponse: vi.fn((err: unknown) => {
    return Response.json({ error: 'no_active_tenant', code: 'no_active_tenant' }, { status: 412 });
  }),
  NoActiveTenantError: class extends Error { constructor() { super('no active tenant'); } },
  StaleActiveTenantError: class extends Error { constructor() { super('stale active tenant'); } },
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    daemonGetProviderHealth: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET } from './route';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant } from '@/src/lib/auth/active-tenant';
import { daemonGetProviderHealth } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: { id: 'user-1', tenantId: 'tenant-1', emailVerified: true, groups: [], roles: [], tenants: [], rolesByTenant: {}, permissions: [], crossTenant: false },
  expires: '2099-01-01T00:00:00Z',
};

type RouteParams = { params: Promise<{ name: string }> };

function makeCtx(name: string): RouteParams {
  return { params: Promise.resolve({ name }) };
}

function makeRequest(): Request {
  return new Request('http://localhost/api/settings/providers/my-anthropic/health', { method: 'GET' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers/[name]/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveTenant).mockResolvedValue('tenant-1');
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(401);
  });

  it('returns healthy status', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockResolvedValue({
      status: 'healthy',
      lastCheckAt: '2026-04-18T00:00:00Z',
      lastError: undefined,
    });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.status).toBe('healthy');
    expect(body.health.lastCheckAt).toBe('2026-04-18T00:00:00Z');
  });

  it('returns unhealthy status with error message', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockResolvedValue({
      status: 'unhealthy',
      lastCheckAt: '2026-04-18T00:00:00Z',
      lastError: 'connection refused',
    });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.status).toBe('unhealthy');
    expect(body.health.lastError).toBe('connection refused');
  });

  it('returns unknown status when no health check has run', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockResolvedValue({
      status: 'unknown',
      lastCheckAt: undefined,
      lastError: undefined,
    });

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.health.status).toBe('unknown');
  });

  it('returns 404 when provider not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockRejectedValue(
      new ConnectError('provider not found', Code.NotFound),
    );

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it.each([
    [Code.Unauthenticated, 401],
    [Code.PermissionDenied, 403],
    [Code.Unavailable, 503],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockRejectedValue(new ConnectError('error', code));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(expectedStatus);
  });

  it('returns 500 for unexpected errors', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockRejectedValue(new Error('unexpected'));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
  });

  it('forwards name, userId, tenantId to client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProviderHealth).mockResolvedValue({ status: 'healthy' });

    await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(daemonGetProviderHealth).toHaveBeenCalledWith('my-anthropic', 'user-1', 'tenant-1');
  });
});
