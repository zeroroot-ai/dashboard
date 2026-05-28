/**
 * Per-route contract test for GET /api/traces/[traceId] (direct trace lookup).
 *
 * Verifies the canonical TraceData shape comes through assembleTraceData and
 * the distinct error responses (401 / 404 not-configured / 404 not-found /
 * 503). The service + assembly helper are mocked so this is a pure route
 * contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetServerSession, mockResolveLangfuseClient, mockAssembleTraceData } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockResolveLangfuseClient: vi.fn(),
    mockAssembleTraceData: vi.fn(),
  }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/langfuse-tenant-service', () => ({
  resolveLangfuseClient: (...args: unknown[]) => mockResolveLangfuseClient(...args),
}));

vi.mock('@/src/lib/trace-detail', () => ({
  assembleTraceData: (...args: unknown[]) => mockAssembleTraceData(...args),
}));

import { GET } from '../route';
import { LangfuseNotFoundError, LangfuseUnavailableError } from '@/src/lib/langfuse-client';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function ctx(traceId: string) {
  return { params: Promise.resolve({ traceId }) };
}

function req(): NextRequest {
  return new NextRequest('http://test.local/api/traces/tr-1');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockResolveLangfuseClient.mockResolvedValue({});
});

describe('GET /api/traces/[traceId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(401);
    expect(mockResolveLangfuseClient).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_CONFIGURED when no credentials resolve', async () => {
    mockResolveLangfuseClient.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED');
  });

  it('returns the assembled TraceData for the trace id', async () => {
    const traceData = {
      traceId: 'tr-1',
      missionId: '',
      startTime: '2026-05-28T10:00:00.000Z',
      endTime: '2026-05-28T10:00:05.000Z',
      totalDurationMs: 5000,
      tokenSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, llmCallCount: 0, byAgent: [], byModel: [] },
      decisions: [],
      traceTree: [],
    };
    mockAssembleTraceData.mockResolvedValueOnce(traceData);

    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(traceData);
    expect(mockAssembleTraceData).toHaveBeenCalledWith(expect.anything(), 'tr-1');
  });

  it('maps a missing trace to 404 NOT_FOUND', async () => {
    mockAssembleTraceData.mockRejectedValueOnce(new LangfuseNotFoundError('trace'));
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('maps an unavailable observability store to 503', async () => {
    mockAssembleTraceData.mockRejectedValueOnce(new LangfuseUnavailableError('down'));
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
