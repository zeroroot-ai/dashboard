/**
 * Per-route contract test for GET /api/missions/:id/events — Loki log tail
 * (dashboard#385).
 *
 * Verifies that while the mission is `running` and Loki is reachable, the SSE
 * bridge tails Loki and forwards each entry as an `event: log` frame, and that
 * an unavailable Loki backend is skipped silently (no log frames, no error
 * frame).
 *
 * The first poll iteration runs synchronously inside the stream's `start()`
 * (before GET resolves), so the open frame + any log frames from that first
 * tick are already buffered when reading begins.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// vi.hoisted() runs before vi.mock() factories execute, so these refs are
// available when the factory closures are evaluated.
const {
  mockGetServerSession,
  mockRequireActiveTenant,
  mockListMissions,
  mockListCheckpoints,
  mockUserClient,
  mockIsReady,
  mockQuery,
} = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockRequireActiveTenant: vi.fn(),
  mockListMissions: vi.fn(),
  mockListCheckpoints: vi.fn(),
  mockUserClient: vi.fn(),
  mockIsReady: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: mockRequireActiveTenant,
  activeTenantApiResponse: vi.fn(),
}));

vi.mock('@/src/lib/gibson-client', () => ({
  listMissions: mockListMissions,
  userClient: () => mockUserClient(),
}));

vi.mock('@/src/lib/loki-client', () => ({
  LokiClient: class {
    isReady = mockIsReady;
    query = mockQuery;
  },
}));

// Static import — GET creates all state per-call (no module-level mutation),
// so a single import shared across tests is safe and avoids the expensive
// vi.resetModules() + dynamic import() re-evaluation on each test.
import { GET } from '../route';

function makeRequest(): NextRequest {
  return new NextRequest('http://test.local/api/missions/m1/events');
}

function makeParams(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/**
 * Reads the SSE stream until `predicate(text)` is satisfied or `maxReads`
 * chunks have been consumed, then returns everything decoded so far.
 */
async function readUntil(
  body: ReadableStream<Uint8Array>,
  predicate: (text: string) => boolean,
  maxReads = 20,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (let i = 0; i < maxReads; i++) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) text += decoder.decode(value, { stream: true });
      if (predicate(text)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

beforeEach(() => {
  mockGetServerSession.mockReset();
  mockRequireActiveTenant.mockReset();
  mockListMissions.mockReset();
  mockListCheckpoints.mockReset();
  mockUserClient.mockReset();
  mockIsReady.mockReset();
  mockQuery.mockReset();

  // Default: active tenant resolves to t1.
  mockRequireActiveTenant.mockResolvedValue('t1');

  // userClient(DaemonService).listCheckpoints(...) — newest-first, empty here.
  mockListCheckpoints.mockResolvedValue({ checkpoints: [] });
  mockUserClient.mockReturnValue({ listCheckpoints: mockListCheckpoints });
});

describe('GET /api/missions/:id/events — Loki log tail', () => {
  it('emits an event: log frame per Loki entry while the mission is running', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u1', tenantId: 't1' },
    });

    // Mission reports running so the Loki-tail branch is entered.
    mockListMissions.mockResolvedValue({
      missions: [{ id: 'm1', status: 'MISSION_STATUS_RUNNING' }],
    });

    mockIsReady.mockResolvedValue(true);
    // Entries must be at-or-after the route's live cursor (initialised to
    // `Date.now()` when the stream opens), otherwise they're skipped as
    // already-seen. Use timestamps a little in the future to stay ahead of it.
    const base = Date.now() + 1000;
    mockQuery.mockResolvedValue([
      {
        timestamp: new Date(base),
        line: JSON.stringify({ level: 'info', msg: 'agent started' }),
        labels: { mission_id: 'm1' },
      },
      {
        timestamp: new Date(base + 1000),
        line: JSON.stringify({ level: 'error', msg: 'tool crashed' }),
        labels: { mission_id: 'm1' },
      },
    ]);

    const res = await GET(makeRequest(), makeParams('m1'));
    expect(res.body).toBeTruthy();

    const countLogFrames = (t: string) =>
      (t.match(/event: log/g) || []).length;

    const text = await readUntil(
      res.body as ReadableStream<Uint8Array>,
      (t) => countLogFrames(t) >= 2,
    );

    expect(countLogFrames(text)).toBeGreaterThanOrEqual(2);
    expect(text).toContain('agent started');
    expect(text).toContain('tool crashed');
    // The Loki query must target this mission's stream.
    expect(mockQuery).toHaveBeenCalled();
    expect(mockQuery.mock.calls[0][0].query).toContain('mission_id="m1"');
  });

  it('emits no log frames when Loki is not ready', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: 'u1', tenantId: 't1' },
    });
    mockListMissions.mockResolvedValue({
      missions: [{ id: 'm1', status: 'MISSION_STATUS_RUNNING' }],
    });
    mockIsReady.mockResolvedValue(false);

    const res = await GET(makeRequest(), makeParams('m1'));

    // Read a short window; we expect the open frame but no log frames.
    const text = await readUntil(
      res.body as ReadableStream<Uint8Array>,
      (t) => t.includes(': open'),
      3,
    );

    expect(text).not.toContain('event: log');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
