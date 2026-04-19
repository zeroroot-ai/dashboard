/**
 * Tests for GET/PUT /api/settings/providers/fallback-chain
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy paths return the daemon response
 * - ConnectErrors are translated to correct HTTP status codes
 * - Body validation (chain must be an array)
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
    daemonGetFallbackChain: vi.fn(),
    daemonSetFallbackChain: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET, PUT } from './route';
import { getServerSession } from '@/src/lib/auth';
import { daemonGetFallbackChain, daemonSetFallbackChain } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: { id: 'user-1', tenantId: 'tenant-1', emailVerified: true, groups: [], roles: [], tenants: [], rolesByTenant: {}, permissions: [], crossTenant: false },
  expires: '2099-01-01T00:00:00Z',
};

function makeGetRequest(): Request {
  return new Request('http://localhost/api/settings/providers/fallback-chain', { method: 'GET' });
}

function makePutRequest(body: unknown): Request {
  return new Request('http://localhost/api/settings/providers/fallback-chain', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/settings/providers/fallback-chain
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers/fallback-chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('returns the fallback chain on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetFallbackChain).mockResolvedValue(['primary-openai', 'backup-anthropic']);

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain).toEqual(['primary-openai', 'backup-anthropic']);
  });

  it('returns an empty chain when none is configured', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetFallbackChain).mockResolvedValue([]);

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chain).toEqual([]);
  });

  it.each([
    [Code.Unauthenticated, 401],
    [Code.PermissionDenied, 403],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonGetFallbackChain).mockRejectedValue(new ConnectError('error', code));

    const res = await GET(makeGetRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(expectedStatus);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/settings/providers/fallback-chain
// ---------------------------------------------------------------------------

describe('PUT /api/settings/providers/fallback-chain', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await PUT(makePutRequest({ chain: ['a', 'b'] }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(401);
  });

  it('returns success when chain is set', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetFallbackChain).mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ chain: ['primary-openai', 'backup-anthropic'] }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('returns success for an empty chain (clears the chain)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetFallbackChain).mockResolvedValue(undefined);

    const res = await PUT(makePutRequest({ chain: [] }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(200);
    expect(daemonSetFallbackChain).toHaveBeenCalledWith([], 'user-1', 'tenant-1');
  });

  it('returns 400 when chain is not an array', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await PUT(makePutRequest({ chain: 'not-an-array' }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const req = new Request('http://localhost/api/settings/providers/fallback-chain', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await PUT(req as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(400);
  });

  it('returns 400 when a chain entry references a non-existent provider', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetFallbackChain).mockRejectedValue(
      new ConnectError('provider "nonexistent" not found', Code.InvalidArgument),
    );

    const res = await PUT(makePutRequest({ chain: ['nonexistent'] }) as Parameters<typeof PUT>[0]);
    expect(res.status).toBe(400);
  });

  it('forwards chain, userId, tenantId to client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonSetFallbackChain).mockResolvedValue(undefined);

    const chain = ['primary-openai', 'backup-anthropic'];
    await PUT(makePutRequest({ chain }) as Parameters<typeof PUT>[0]);
    expect(daemonSetFallbackChain).toHaveBeenCalledWith(chain, 'user-1', 'tenant-1');
  });
});
