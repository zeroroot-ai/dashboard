/**
 * Tests for GET/PUT /api/settings/providers/default
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy paths return the daemon response
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

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    daemonGetDefaultProvider: vi.fn(),
    daemonSetDefaultProvider: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET, PUT } from './route';
import { getServerSession } from '@/src/lib/auth';
import { daemonGetDefaultProvider, daemonSetDefaultProvider } from '@/src/lib/gibson-client';

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
  isDefault: true,
  enabled: true,
  credentialsMasked: { api_key: '****abcd' },
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
};

function makeGetRequest(): Request {
  return new Request('http://localhost/api/settings/providers/default', { method: 'GET' });
}

function makePutRequest(body: unknown): Request {
  return new Request('http://localhost/api/settings/providers/default', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/settings/providers/default
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers/default', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('returns the default provider when one is set', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetDefaultProvider).mockResolvedValue(mockProvider);

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.name).toBe('my-anthropic');
    expect(body.provider.isDefault).toBe(true);
  });

  it('returns { provider: null } when no default is set', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetDefaultProvider).mockResolvedValue(null);

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider).toBeNull();
  });

  it.each([
    [Code.Unauthenticated, 401],
    [Code.PermissionDenied, 403],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetDefaultProvider).mockRejectedValue(new ConnectError('error', code));

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/settings/providers/default
// ---------------------------------------------------------------------------

describe('PUT /api/settings/providers/default', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await PUT(makePutRequest({ name: 'my-anthropic' }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(401);
  });

  it('returns success when default is set', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetDefaultProvider).mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ name: 'my-anthropic' }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns 400 when name is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await PUT(makePutRequest({}) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const req = new Request('http://localhost/api/settings/providers/default', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await PUT(req as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 404 when provider not found', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetDefaultProvider).mockRejectedValue(new ConnectError('not found', Code.NotFound));

    const res = await PUT(makePutRequest({ name: 'nonexistent' }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(404);
  });

  it('forwards name, userId, tenantId to client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetDefaultProvider).mockResolvedValue(undefined);

    await PUT(makePutRequest({ name: 'my-anthropic' }) as Parameters<typeof PUT>[0]);
    expect(daemonSetDefaultProvider).toHaveBeenCalledWith('my-anthropic', 'user-1', 'tenant-1');
  });
});
