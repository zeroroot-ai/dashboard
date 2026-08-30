/**
 * Per-route contract test for GET /api/agents/:runId/events, the live
 * agent event bridge (dashboard#1148).
 *
 * The `since` cursor reaches the daemon client as `sinceSeq`, every chunk
 * frame carries the daemon's `seq` as its payload and as the SSE id, and a
 * bad cursor is a 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockGetServerSession, mockRequireActiveTenant, mockStreamAgentEvents } = vi.hoisted(
  () => ({
    mockGetServerSession: vi.fn(),
    mockRequireActiveTenant: vi.fn(),
    mockStreamAgentEvents: vi.fn(),
  }),
);

vi.mock('@/src/lib/auth', () => ({ getServerSession: mockGetServerSession }));
vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: vi.fn(),
}));
vi.mock('@/src/lib/gibson-client/agent-console', () => ({
  streamAgentEvents: mockStreamAgentEvents,
}));
vi.mock('@/src/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { GET } from '../route';

function makeRequest(query = ''): NextRequest {
  return new NextRequest('http://test.local/api/agents/run-1/events' + query);
}

function makeParams(runId: string): { params: Promise<{ runId: string }> } {
  return { params: Promise.resolve({ runId }) };
}

async function readAll(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

function events(...items: { seq: bigint; data: string }[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const it of items) {
        yield {
          unixNanos: BigInt(1000) + it.seq,
          seq: it.seq,
          data: new TextEncoder().encode(it.data),
        };
      }
    },
  };
}

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockRequireActiveTenant.mockReset();
  mockStreamAgentEvents.mockReset();
  mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
  mockRequireActiveTenant.mockResolvedValue(undefined);
});

describe('GET /api/agents/:runId/events', () => {
  it('passes the since cursor to the daemon and echoes seq on every frame', async () => {
    mockStreamAgentEvents.mockReturnValue(
      events({ seq: BigInt(8), data: 'eight\n' }, { seq: BigInt(9), data: 'nine\n' }),
    );
    const res = await GET(makeRequest('?since=7'), makeParams('run-1'));
    expect(res.status).toBe(200);
    expect(mockStreamAgentEvents).toHaveBeenCalledWith('run-1', BigInt(7), expect.any(AbortSignal));
    const text = await readAll(res.body as ReadableStream<Uint8Array>);
    expect(text).toContain('id: 8\nevent: chunk\n');
    expect(text).toContain('id: 9\nevent: chunk\n');
    const frames = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]));
    const chunks = frames.filter((f) => f.seq !== undefined);
    expect(chunks.map((c) => c.seq)).toEqual(['8', '9']);
    expect(Buffer.from(chunks[0].dataB64, 'base64').toString()).toBe('eight\n');
    expect(text).toContain('event: end');
  });

  it('defaults the cursor to zero, the whole backlog', async () => {
    mockStreamAgentEvents.mockReturnValue(events());
    const res = await GET(makeRequest(), makeParams('run-1'));
    expect(res.status).toBe(200);
    expect(mockStreamAgentEvents).toHaveBeenCalledWith('run-1', BigInt(0), expect.any(AbortSignal));
    await readAll(res.body as ReadableStream<Uint8Array>);
  });

  it('rejects a cursor that is not a non-negative integer', async () => {
    for (const bad of ['?since=-1', '?since=abc', '?since=1.5']) {
      const res = await GET(makeRequest(bad), makeParams('run-1'));
      expect(res.status, bad).toBe(400);
    }
    expect(mockStreamAgentEvents).not.toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest(), makeParams('run-1'));
    expect(res.status).toBe(401);
  });
});
