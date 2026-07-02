/**
 * Per-route contract test for GET /api/traces (tenant-wide run list).
 *
 * The Gibson Traces list reads WorldService.ListLlmCalls and groups the flat
 * call log into runs (gibson#755). WorldService is mocked via userClient so this
 * is a pure route contract: the run grouping + token rollup, plus the 401 / 412
 * auth paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockListLlmCalls = vi.fn();

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
      listLlmCalls: (...args: unknown[]) => mockListLlmCalls(...args),
    }),
  };
});

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function req(url = 'http://test.local/api/traces'): NextRequest {
  return new NextRequest(url);
}

function call(over: Record<string, unknown> = {}) {
  return {
    callId: 'c1',
    runId: 'run-1',
    model: 'claude-opus-4',
    scopeId: 's1',
    promptTokens: 1200,
    completionTokens: 480,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
  mockRequireActiveTenant.mockResolvedValue('t1');
  mockListLlmCalls.mockResolvedValue({ llmCalls: [] });
});

describe('GET /api/traces', () => {
  it('returns 401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListLlmCalls).not.toHaveBeenCalled();
  });

  it('returns 412 when no active tenant', async () => {
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    const res = await GET(req());
    expect(res.status).toBe(412);
    expect(mockListLlmCalls).not.toHaveBeenCalled();
  });

  it('groups calls into runs by run id with token rollups', async () => {
    mockListLlmCalls.mockResolvedValueOnce({
      llmCalls: [
        call({ callId: 'c1', runId: 'run-1' }),
        call({ callId: 'c2', runId: 'run-1', promptTokens: 100, completionTokens: 50 }),
        call({ callId: 'c3', runId: 'run-2', model: 'gpt-4o' }),
      ],
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.runs).toHaveLength(2);
    const run1 = body.runs.find((r: { id: string }) => r.id === 'run-1');
    expect(run1).toMatchObject({
      id: 'run-1',
      label: 'run-1',
      callCount: 2,
      promptTokens: 1300,
      completionTokens: 530,
      totalTokens: 1830,
    });
    expect(run1.models).toEqual(['claude-opus-4']);
    expect(run1.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('collapses empty run ids into one ungrouped run', async () => {
    mockListLlmCalls.mockResolvedValueOnce({
      llmCalls: [call({ callId: 'c1', runId: '' }), call({ callId: 'c2', runId: '' })],
    });

    const res = await GET(req());
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({ id: '', label: 'Ungrouped calls', callCount: 2 });
  });

  it('returns an empty run list when there are no calls', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.runs).toEqual([]);
  });
});
