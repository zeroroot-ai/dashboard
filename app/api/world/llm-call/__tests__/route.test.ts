/**
 * Per-route contract test for /api/world/llm-call (the per-tick inspector's
 * transcript fetch, gibson#1059). WorldService is mocked via userClient so this
 * is a pure route contract: GET maps the LlmCallDetail, plus the 401, 400
 * (missing callId), and 404 (unknown call) paths. The daemon enforces tenant
 * isolation; this verifies the dashboard forwards the callId and never touches
 * the brain directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetLlmCall = vi.fn();

const { mockGetServerSession } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      getLlmCall: (...args: unknown[]) => mockGetLlmCall(...args),
    }),
  };
});

vi.mock('server-only', () => ({}));

import { GET } from '../route';

const SESSION = { user: { id: 'u1', tenantId: 't1' } };

function getReq(query: string): NextRequest {
  return new NextRequest(`http://test.local/api/world/llm-call${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue(SESSION);
});

describe('GET /api/world/llm-call', () => {
  it('maps the call detail (metadata + transcript) and forwards the callId', async () => {
    mockGetLlmCall.mockResolvedValue({
      call: {
        callId: 'c1',
        runId: 'r1',
        model: 'gpt-4',
        scopeId: 's1',
        promptTokens: 10,
        completionTokens: 5,
        messages: [
          { role: 'system', content: 'you are a pentester' },
          { role: 'user', content: 'scan it' },
        ],
        completion: 'open ports: 22, 443',
      },
    });

    const res = await GET(getReq('?callId=c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockGetLlmCall).toHaveBeenCalledWith({ callId: 'c1' });
    expect(body.callId).toBe('c1');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'you are a pentester' });
    expect(body.completion).toBe('open ports: 22, 443');
  });

  it('400 when callId is missing', async () => {
    const res = await GET(getReq(''));
    expect(res.status).toBe(400);
    expect(mockGetLlmCall).not.toHaveBeenCalled();
  });

  it('404 when the daemon returns no call', async () => {
    mockGetLlmCall.mockResolvedValue({ call: undefined });
    const res = await GET(getReq('?callId=nope'));
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(getReq('?callId=c1'));
    expect(res.status).toBe(401);
    expect(mockGetLlmCall).not.toHaveBeenCalled();
  });
});
