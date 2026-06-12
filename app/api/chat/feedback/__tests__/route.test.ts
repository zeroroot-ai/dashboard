/**
 * Tests for POST /api/chat/feedback
 *
 * Verifies:
 * - Unauthenticated → 401
 * - Valid thumbs-up → addTraceScore(value=1) + 204
 * - Valid thumbs-down → addTraceScore(value=0) + 204
 * - Missing traceId → 400
 * - Daemon error on addTraceScore → 204 (no-op, optimistic fill-thumb)
 * - No active tenant → 412
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks, hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

const mockAddTraceScore = vi.fn();

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
      addTraceScore: (...args: unknown[]) => mockAddTraceScore(...args),
    }),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '../route';
import { getServerSession } from '@/src/lib/auth';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: {
    id: 'user-1',
    tenantId: 'tenant-1',
    emailVerified: true,
    groups: [],
    roles: [],
    tenants: [],
    rolesByTenant: {},
    permissions: [],
    crossTenant: false,
  },
  expires: '2099-01-01T00:00:00Z',
};

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/chat/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat/feedback', () => {
  beforeEach(() => {
    mockAddTraceScore.mockReset();
    mockAddTraceScore.mockResolvedValue({});
    vi.mocked(getServerSession).mockResolvedValue(null);
    mockRequireActiveTenant.mockResolvedValue('tenant-1');
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(401);
    expect(mockAddTraceScore).not.toHaveBeenCalled();
  });

  it('returns 412 when no active tenant', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    mockRequireActiveTenant.mockRejectedValueOnce(new Error('no tenant'));
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(412);
    expect(mockAddTraceScore).not.toHaveBeenCalled();
  });

  it('records a thumbs-up as value 1.0 and returns 204', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(204);
    expect(mockAddTraceScore).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        name: 'user-feedback',
        value: 1.0,
      }),
    );
  });

  it('records a thumbs-down as value 0.0 and returns 204', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'down' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(204);
    expect(mockAddTraceScore).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        name: 'user-feedback',
        value: 0.0,
      }),
    );
  });

  it('returns 400 when traceId is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(mockAddTraceScore).not.toHaveBeenCalled();
  });

  it('returns 400 when rating is invalid', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'maybe' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(mockAddTraceScore).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not valid JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(makeRequest('not-json{') as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(mockAddTraceScore).not.toHaveBeenCalled();
  });

  it('returns 204 no-op when the daemon addTraceScore fails (optimistic fill-thumb)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    mockAddTraceScore.mockRejectedValueOnce(new Error('daemon unavailable'));

    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    // Must not revert the optimistic fill-thumb, 204 even on backend failure.
    expect(res.status).toBe(204);
  });
});
