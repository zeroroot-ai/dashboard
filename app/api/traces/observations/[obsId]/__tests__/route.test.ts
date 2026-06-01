/**
 * Per-route contract test for GET /api/traces/observations/[obsId]
 * (mission-agnostic observation detail). Verifies auth gating, the
 * assembled observation envelope, and the 401/404/412 error paths.
 * TracesService is mocked via userClient; assembleObservationDetail is
 * mocked from traces-client. Pure route contract test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

const mockGetObservation = vi.fn();
const mockAssembleObservationDetail = vi.fn();

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
      getObservation: (...args: unknown[]) => mockGetObservation(...args),
    }),
  };
});

vi.mock('@/src/lib/traces-client', () => ({
  assembleObservationDetail: (...args: unknown[]) => mockAssembleObservationDetail(...args),
}));

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };
const ctx = (obsId: string) => ({ params: Promise.resolve({ obsId }) });
const req = () => new NextRequest('http://test.local/api/traces/observations/o1');

const OBS_RECORD = {
  id: 'o1',
  traceId: 'tr-1',
  type: 'GENERATION',
  name: 'gen',
  startTime: { seconds: BigInt(1748433600), nanos: 0 },
  endTime: null,
  parentObservationId: '',
  model: 'gpt-4o',
  inputJson: '',
  outputJson: '',
  metadataJson: '',
  promptTokens: BigInt(10),
  completionTokens: BigInt(5),
  totalTokens: BigInt(15),
  level: 'DEFAULT',
  statusMessage: '',
};

const OBSERVATION_DETAIL = {
  id: 'o1',
  contentAvailable: false,
  messages: [],
  metadata: { model: 'gpt-4o', inputTokens: 10, outputTokens: 5, latencyMs: 0, estimatedCostUsd: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockRequireActiveTenant.mockResolvedValue('t1');
  mockGetObservation.mockResolvedValue({ observation: OBS_RECORD });
  mockAssembleObservationDetail.mockReturnValue(OBSERVATION_DETAIL);
});

describe('GET /api/traces/observations/[obsId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(401);
    expect(mockGetObservation).not.toHaveBeenCalled();
  });

  it('returns 412 when no active tenant', async () => {
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(412);
    expect(mockGetObservation).not.toHaveBeenCalled();
  });

  it('returns 404 when daemon returns NOT_FOUND', async () => {
    mockGetObservation.mockRejectedValueOnce(
      new ConnectError('observation not found', Code.NotFound),
    );
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 when observation is absent in response', async () => {
    mockGetObservation.mockResolvedValueOnce({ observation: undefined });
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(404);
  });

  it('wraps the assembled observation under { observation }', async () => {
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ observation: OBSERVATION_DETAIL });
    expect(mockAssembleObservationDetail).toHaveBeenCalledWith(OBS_RECORD);
  });
});
