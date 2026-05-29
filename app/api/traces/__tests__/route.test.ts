/**
 * Per-route contract test for GET /api/traces (tenant-wide trace list).
 *
 * Verifies the serialised TraceSummary projection, query-param pass-through
 * to LangfuseTenantService, and the distinct error responses (401 / 404 /
 * 503). LangfuseTenantService is mocked so the test is a pure route contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetServerSession, mockResolveLangfuseClient, mockListTenantTraces } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockResolveLangfuseClient: vi.fn(),
    mockListTenantTraces: vi.fn(),
  }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/langfuse-tenant-service', () => ({
  resolveLangfuseClient: (...args: unknown[]) => mockResolveLangfuseClient(...args),
  listTenantTraces: (...args: unknown[]) => mockListTenantTraces(...args),
}));

// Real error classes so the route's instanceof checks work (no mock).

import { GET } from '../route';
import { LangfuseUnavailableError } from '@/src/lib/langfuse-client';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function req(url = 'http://test.local/api/traces'): NextRequest {
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockResolveLangfuseClient.mockResolvedValue({ /* opaque client */ });
});

describe('GET /api/traces', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockResolveLangfuseClient).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_CONFIGURED when no credentials resolve', async () => {
    mockResolveLangfuseClient.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_CONFIGURED');
  });

  it('projects traces into the TraceSummary shape', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [
        {
          id: 'tr-1',
          name: 'recon-agent-run',
          timestamp: '2026-05-28T10:00:00.000Z',
          metadata: {},
          tags: ['mission:m1'],
          sessionId: 'sess-1',
          totalTokens: 1680,
          promptTokens: 1200,
          completionTokens: 480,
          latency: 5500,
          observations: [],
        },
        {
          id: 'tr-2',
          name: 'failed-run',
          timestamp: '2026-05-28T09:00:00.000Z',
          metadata: { error: 'boom' },
          tags: [],
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          latency: 0,
          observations: [],
        },
      ],
      meta: { page: 1, limit: 25, totalItems: 2, totalPages: 1 },
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.meta).toEqual({ page: 1, totalPages: 1, totalItems: 2 });
    expect(body.data[0]).toEqual({
      id: 'tr-1',
      name: 'recon-agent-run',
      timestamp: '2026-05-28T10:00:00.000Z',
      status: 'ok',
      totalTokens: 1680,
      promptTokens: 1200,
      completionTokens: 480,
      latencyMs: 5500,
      tags: ['mission:m1'],
      sessionId: 'sess-1',
    });
    // metadata.error → status 'error'.
    expect(body.data[1].status).toBe('error');
  });

  it('passes pagination, date range, and name filters through to the service', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [],
      meta: { page: 2, limit: 10, totalItems: 0, totalPages: 0 },
    });

    await GET(
      req('http://test.local/api/traces?page=2&limit=10&from=2026-01-01&to=2026-01-31&name=recon'),
    );

    expect(mockListTenantTraces).toHaveBeenCalledWith(expect.anything(), {
      page: 2,
      limit: 10,
      fromTimestamp: '2026-01-01T00:00:00.000Z',
      toTimestamp: '2026-01-31T23:59:59.999Z',
      name: 'recon',
    });
  });

  it('passes a userId filter through (Usage → Traces deep-link)', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, limit: 25, totalItems: 0, totalPages: 0 },
    });
    await GET(req('http://test.local/api/traces?userId=user-42'));
    expect(mockListTenantTraces).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-42' }),
    );
  });

  it('passes repeated tags filters through (by-agent / by-mission deep-link)', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, limit: 25, totalItems: 0, totalPages: 0 },
    });
    await GET(req('http://test.local/api/traces?tags=agent:recon&tags=mission:m1'));
    expect(mockListTenantTraces).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tags: ['agent:recon', 'mission:m1'] }),
    );
  });

  it('caps the page size at 100', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, limit: 100, totalItems: 0, totalPages: 0 },
    });
    await GET(req('http://test.local/api/traces?limit=5000'));
    expect(mockListTenantTraces).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('ignores invalid date filters rather than failing', async () => {
    mockListTenantTraces.mockResolvedValueOnce({
      data: [],
      meta: { page: 1, limit: 25, totalItems: 0, totalPages: 0 },
    });
    await GET(req('http://test.local/api/traces?from=not-a-date'));
    expect(mockListTenantTraces).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fromTimestamp: undefined }),
    );
  });

  it('maps an unavailable observability store to 503', async () => {
    mockListTenantTraces.mockRejectedValueOnce(
      new LangfuseUnavailableError('down'),
    );
    const res = await GET(req());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
