/**
 * Per-route contract test for GET /api/traces/observations/[obsId]
 * (mission-agnostic observation detail). Verifies auth gating, the
 * assembled observation envelope, and the 404 / 503 error paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetServerSession, mockResolveLangfuseClient, mockAssembleObservationDetail } =
  vi.hoisted(() => ({
    mockGetServerSession: vi.fn(),
    mockResolveLangfuseClient: vi.fn(),
    mockAssembleObservationDetail: vi.fn(),
  }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/langfuse-tenant-service', () => ({
  resolveLangfuseClient: (...args: unknown[]) => mockResolveLangfuseClient(...args),
}));

vi.mock('@/src/lib/trace-detail', () => ({
  assembleObservationDetail: (...args: unknown[]) => mockAssembleObservationDetail(...args),
}));

import { GET } from '../route';
import { LangfuseNotFoundError, LangfuseUnavailableError } from '@/src/lib/langfuse-client';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };
const ctx = (obsId: string) => ({ params: Promise.resolve({ obsId }) });
const req = () => new NextRequest('http://test.local/api/traces/observations/o1');

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockResolveLangfuseClient.mockResolvedValue({});
});

describe('GET /api/traces/observations/[obsId]', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when observability is not configured', async () => {
    mockResolveLangfuseClient.mockResolvedValueOnce(null);
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED');
  });

  it('wraps the assembled observation under { observation }', async () => {
    const observation = {
      id: 'o1',
      contentAvailable: true,
      messages: [{ role: 'assistant', content: 'hi' }],
      metadata: { model: 'gpt-4o', inputTokens: 10, outputTokens: 5, latencyMs: 100, estimatedCostUsd: 0 },
    };
    mockAssembleObservationDetail.mockResolvedValueOnce(observation);
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ observation });
    expect(mockAssembleObservationDetail).toHaveBeenCalledWith(expect.anything(), 'o1');
  });

  it('maps a missing observation to 404', async () => {
    mockAssembleObservationDetail.mockRejectedValueOnce(new LangfuseNotFoundError('obs'));
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('maps an unavailable store to 503', async () => {
    mockAssembleObservationDetail.mockRejectedValueOnce(new LangfuseUnavailableError('down'));
    const res = await GET(req(), ctx('o1'));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
