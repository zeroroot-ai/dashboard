/**
 * Tests for GET/PATCH/DELETE /api/settings/providers/[name]
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy paths return the daemon response
 * - ConnectErrors are translated to correct HTTP status codes
 * - Credentials never appear in response bodies
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
  unsafeTenantId: (v: string) => v,
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
    daemonGetProvider: vi.fn(),
    daemonUpdateProvider: vi.fn(),
    daemonDeleteProvider: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET, PATCH, DELETE } from './route';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, unsafeTenantId } from '@/src/lib/auth/active-tenant';
import { daemonGetProvider, daemonUpdateProvider, daemonDeleteProvider } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: { id: 'user-1', tenantId: 'tenant-1', emailVerified: true, groups: [], roles: [], tenants: [], rolesByTenant: {}, permissions: [], crossTenant: false },
  expires: '2099-01-01T00:00:00Z',
};

const mockProvider = {
  id: 'prov-uuid-1',
  name: 'my-anthropic',
  type: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-20241022',
  isDefault: false,
  enabled: true,
  credentialsMasked: { api_key: '****abcd' },
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
};

type RouteParams = { params: Promise<{ name: string }> };

function makeCtx(name: string): RouteParams {
  return { params: Promise.resolve({ name }) };
}

function makeRequest(method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost/api/settings/providers/my-anthropic`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// GET /api/settings/providers/[name]
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveTenant).mockResolvedValue(unsafeTenantId('tenant-1'));
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(401);
  });

  it('returns 412 when no active tenant cookie', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(requireActiveTenant).mockRejectedValue(new Error('no active tenant'));
    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(412);
  });

  it('returns the provider on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProvider).mockResolvedValue(mockProvider);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.name).toBe('my-anthropic');
    expect(body.provider.credentialsMasked.api_key).toBe('****abcd');
  });

  it('returns 404 when provider not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProvider).mockRejectedValue(new ConnectError('not found', Code.NotFound));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('forwards name, userId, tenantId to client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetProvider).mockResolvedValue(mockProvider);

    await GET(makeRequest() as Parameters<typeof GET>[0], makeCtx('my-anthropic'));
    expect(daemonGetProvider).toHaveBeenCalledWith('my-anthropic', 'user-1', 'tenant-1');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/settings/providers/[name]
// ---------------------------------------------------------------------------

describe('PATCH /api/settings/providers/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveTenant).mockResolvedValue(unsafeTenantId('tenant-1'));
  });

  const updateInput = {
    name: 'my-anthropic',
    type: 'anthropic',
    defaultModel: 'claude-3-haiku-20240307',
    credentials: { api_key: 'sk-ant-api03-updated-key' },
  };

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await PATCH(makeRequest('PATCH', updateInput) as Parameters<typeof PATCH>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(401);
  });

  it('returns updated provider on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonUpdateProvider).mockResolvedValue({ ...mockProvider, defaultModel: 'claude-3-haiku-20240307' });

    const res = await PATCH(makeRequest('PATCH', updateInput) as Parameters<typeof PATCH>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.defaultModel).toBe('claude-3-haiku-20240307');
    // Plaintext credential must not appear in response
    expect(JSON.stringify(body)).not.toContain('sk-ant-api03-updated-key');
  });

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const req = new Request('http://localhost/api/settings/providers/my-anthropic', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    const res = await PATCH(req as Parameters<typeof PATCH>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(400);
  });

  it.each([
    [Code.NotFound, 404],
    [Code.PermissionDenied, 403],
    [Code.InvalidArgument, 400],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonUpdateProvider).mockRejectedValue(new ConnectError('error', code));

    const res = await PATCH(makeRequest('PATCH', updateInput) as Parameters<typeof PATCH>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(expectedStatus);
    // No credential leakage in error
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant-api03-updated-key');
  });

  it('does not leak credentials in error responses', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonUpdateProvider).mockRejectedValue(new ConnectError('not found', Code.NotFound));

    const res = await PATCH(makeRequest('PATCH', updateInput) as Parameters<typeof PATCH>[0], makeCtx('my-anthropic'));
    const text = await res.text();
    expect(text).not.toContain('sk-ant-api03-updated-key');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/settings/providers/[name]
// ---------------------------------------------------------------------------

describe('DELETE /api/settings/providers/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveTenant).mockResolvedValue(unsafeTenantId('tenant-1'));
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await DELETE(makeRequest('DELETE') as Parameters<typeof DELETE>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(401);
  });

  it('returns success on deletion', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonDeleteProvider).mockResolvedValue(undefined);

    const res = await DELETE(makeRequest('DELETE') as Parameters<typeof DELETE>[0], makeCtx('my-anthropic'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 404 when provider not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonDeleteProvider).mockRejectedValue(new ConnectError('not found', Code.NotFound));

    const res = await DELETE(makeRequest('DELETE') as Parameters<typeof DELETE>[0], makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('forwards name, userId, tenantId to client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonDeleteProvider).mockResolvedValue(undefined);

    await DELETE(makeRequest('DELETE') as Parameters<typeof DELETE>[0], makeCtx('my-anthropic'));
    expect(daemonDeleteProvider).toHaveBeenCalledWith('my-anthropic', 'user-1', 'tenant-1');
  });
});
