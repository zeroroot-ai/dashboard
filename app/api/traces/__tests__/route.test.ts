/**
 * Per-route contract test for GET /api/traces (tenant-wide trace list).
 *
 * Verifies the serialised TraceSummary projection, query-param pass-through
 * to TracesService.listTraces, and the distinct error responses (401 / 412).
 * TracesService is mocked via userClient so this is a pure route contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockListTraces = vi.fn();

const { mockGetServerSession, mockRequireActiveTenant } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireActiveTenant: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: (...args: unknown[]) => mockRequireActiveTenant(...args),
  activeTenantApiResponse: vi.fn((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'no tenant';
    return new Response(JSON.stringify({ error: { code: 'no_active_tenant', message: msg } }), {
      status: 412,
      headers: { 'Content-Type': 'application/json' },
    });
  }),
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      listTraces: (...args: unknown[]) => mockListTraces(...args),
    }),
    timestampToISO: actual.timestampToISO,
  };
});

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function req(url = 'http://test.local/api/traces'): NextRequest {
  return new NextRequest(url);
}

// Build a proto-like TraceRecord with a timestamp field (seconds/nanos bigint).
function makeTraceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tr-1',
    name: 'recon-agent-run',
    timestamp: { seconds: BigInt(1748433600), nanos: 0 },
    tags: ['mission:m1'],
    sessionId: 'sess-1',
    totalTokens: BigInt(1680),
    promptTokens: BigInt(1200),
    completionTokens: BigInt(480),
    latencyMs: 5500,
    observationIds: [],
    userId: '',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockRequireActiveTenant.mockResolvedValue('t1');
  mockListTraces.mockResolvedValue({
    traces: [],
    nextPageToken: '',
    totalItems: BigInt(0),
  });
});

describe('GET /api/traces', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListTraces).not.toHaveBeenCalled();
  });

  it('returns 412 when no active tenant', async () => {
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    const res = await GET(req());
    expect(res.status).toBe(412);
    expect(mockListTraces).not.toHaveBeenCalled();
  });

  it('projects traces into the TraceSummary shape', async () => {
    mockListTraces.mockResolvedValueOnce({
      traces: [
        makeTraceRecord({ id: 'tr-1', name: 'recon-agent-run' }),
      ],
      nextPageToken: '',
      totalItems: BigInt(1),
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.meta).toMatchObject({ page: 1, totalItems: 1 });
    expect(body.data[0]).toMatchObject({
      id: 'tr-1',
      name: 'recon-agent-run',
      status: 'ok',
      totalTokens: 1680,
      promptTokens: 1200,
      completionTokens: 480,
      latencyMs: 5500,
      tags: ['mission:m1'],
      sessionId: 'sess-1',
    });
  });

  it('passes pagination and filters through to TracesService', async () => {
    await GET(
      req('http://test.local/api/traces?page=2&limit=10&from=2026-01-01&to=2026-01-31&name=recon'),
    );

    expect(mockListTraces).toHaveBeenCalledWith(
      expect.objectContaining({
        pageSize: 10,
        pageToken: '2',
        fromTimestamp: '2026-01-01T00:00:00.000Z',
        toTimestamp: '2026-01-31T23:59:59.999Z',
        name: 'recon',
      }),
    );
  });

  it('passes userId filter through', async () => {
    await GET(req('http://test.local/api/traces?userId=user-42'));
    expect(mockListTraces).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-42' }),
    );
  });

  it('passes repeated tags filters through', async () => {
    await GET(req('http://test.local/api/traces?tags=agent:recon&tags=mission:m1'));
    expect(mockListTraces).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['agent:recon', 'mission:m1'] }),
    );
  });

  it('caps the page size at 100', async () => {
    await GET(req('http://test.local/api/traces?limit=5000'));
    expect(mockListTraces).toHaveBeenCalledWith(
      expect.objectContaining({ pageSize: 100 }),
    );
  });

  it('uses empty string for invalid date filters', async () => {
    await GET(req('http://test.local/api/traces?from=not-a-date'));
    expect(mockListTraces).toHaveBeenCalledWith(
      expect.objectContaining({ fromTimestamp: '' }),
    );
  });
});
