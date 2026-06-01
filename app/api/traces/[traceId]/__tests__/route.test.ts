/**
 * Per-route contract test for GET /api/traces/[traceId] (direct trace lookup).
 *
 * Verifies the canonical TraceData shape comes through assembleTraceData and
 * the distinct error responses (401 / 412 / 404). TracesService is mocked via
 * userClient; assembleTraceData is mocked from traces-client. Pure route
 * contract test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const mockGetTrace = vi.fn();
const mockGetObservation = vi.fn();
const mockAssembleTraceData = vi.fn();

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
      getTrace: (...args: unknown[]) => mockGetTrace(...args),
      getObservation: (...args: unknown[]) => mockGetObservation(...args),
    }),
    timestampToISO: actual.timestampToISO,
  };
});

vi.mock('@/src/lib/traces-client', () => ({
  assembleTraceData: (...args: unknown[]) => mockAssembleTraceData(...args),
}));

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function ctx(traceId: string) {
  return { params: Promise.resolve({ traceId }) };
}

function req(): NextRequest {
  return new NextRequest('http://test.local/api/traces/tr-1');
}

const TRACE_RECORD = {
  id: 'tr-1',
  name: 'recon-run',
  timestamp: { seconds: BigInt(1748433600), nanos: 0 },
  tags: [],
  userId: '',
  sessionId: '',
  totalTokens: BigInt(0),
  promptTokens: BigInt(0),
  completionTokens: BigInt(0),
  latencyMs: 0,
  observationIds: [],
};

const TRACE_DATA = {
  traceId: 'tr-1',
  missionId: '',
  startTime: '2026-05-28T10:00:00.000Z',
  endTime: '2026-05-28T10:00:05.000Z',
  totalDurationMs: 5000,
  tokenSummary: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, llmCallCount: 0, byAgent: [], byModel: [] },
  decisions: [],
  traceTree: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockRequireActiveTenant.mockResolvedValue('t1');
  mockGetTrace.mockResolvedValue({ trace: TRACE_RECORD });
  mockGetObservation.mockResolvedValue({ observation: null });
  mockAssembleTraceData.mockReturnValue(TRACE_DATA);
});

describe('GET /api/traces/[traceId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(401);
    expect(mockGetTrace).not.toHaveBeenCalled();
  });

  it('returns 412 when no active tenant', async () => {
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(412);
    expect(mockGetTrace).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when the daemon returns NOT_FOUND', async () => {
    mockGetTrace.mockRejectedValueOnce(
      new ConnectError('trace not found', Code.NotFound),
    );
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 NOT_FOUND when trace is absent in response', async () => {
    mockGetTrace.mockResolvedValueOnce({ trace: undefined });
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(404);
  });

  it('returns the assembled TraceData for the trace id', async () => {
    const res = await GET(req(), ctx('tr-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TRACE_DATA);
    expect(mockAssembleTraceData).toHaveBeenCalled();
  });
});
