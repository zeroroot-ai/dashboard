// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Per-route contract test for /api/world/llm-call (the model call fetch of the
 * per-tick inspector, gibson#1059). WorldService is mocked via userClient so this
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
  it('maps the model call detail and forwards the callId', async () => {
    mockGetLlmCall.mockResolvedValue({
      call: {
        callId: 'c1',
        runId: 'r1',
        model: 'gpt-4',
        scopeId: 's1',
        promptTokens: 10,
        completionTokens: 5,
        requestItems: [
          '{"type":"message","role":"system","content":"you are a pentester"}',
          '{"type":"message","role":"user","content":"scan it"}',
        ],
        outputItems: ['{"type":"message","role":"assistant","content":"open ports: 22, 443"}'],
        provider: 'openai',
        httpStatus: 200,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        cost: '0.0021',
        errorText: '',
      },
    });

    const res = await GET(getReq('?callId=c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockGetLlmCall).toHaveBeenCalledWith({ callId: 'c1' });
    expect(body.callId).toBe('c1');
    expect(body.requestItems).toHaveLength(2);
    expect(body.requestItems[0]).toEqual({
      kind: 'message',
      role: 'system',
      text: 'you are a pentester',
    });
    expect(body.outputItems).toEqual([
      { kind: 'message', role: 'assistant', text: 'open ports: 22, 443' },
    ]);
    expect(body.provider).toBe('openai');
    expect(body.httpStatus).toBe(200);
    expect(body.cacheReadTokens).toBe(4);
    expect(body.cacheWriteTokens).toBe(2);
    expect(body.cost).toBe('0.0021');
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
