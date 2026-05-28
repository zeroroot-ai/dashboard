/**
 * Tests for POST /api/chat/feedback
 *
 * Verifies:
 * - Unauthenticated → 401
 * - Valid thumbs-up → createScore(value=1) + 204
 * - Valid thumbs-down → createScore(value=0) + 204
 * - Missing traceId → 400
 * - LangfuseUnavailableError → 503 with structured error body
 * - Langfuse not configured (host null) → 204 no-op
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('server-only', () => ({}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/config', () => ({
  serverConfig: {
    langfuseHost: 'http://langfuse.test',
    langfuseAdminPublicKey: 'pk-test',
    langfuseAdminSecretKey: 'sk-test',
  },
}));

// Shared spy for createScore — installed on the LangfuseClient prototype
// so all instances created within the route share the same mock fn.
const createScoreSpy = vi.fn();

// Spy on the LangfuseClient constructor + replace its prototype method.
// We avoid a wholesale `vi.fn()` replacement because the route checks
// `instanceof LangfuseUnavailableError` and we want the genuine error
// classes to remain importable from the same module specifier.
vi.mock('@/src/lib/langfuse-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/langfuse-client')>();
  // Replace createScore on the prototype so every `new LangfuseClient()`
  // instance constructed inside the route uses our spy.
  actual.LangfuseClient.prototype.createScore = (
    ...args: Parameters<typeof actual.LangfuseClient.prototype.createScore>
  ) => createScoreSpy(...args);
  return actual;
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '../route';
import { getServerSession } from '@/src/lib/auth';
import { LangfuseUnavailableError } from '@/src/lib/langfuse-client';
import { serverConfig } from '@/src/lib/config';

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
  // Convenience alias to the module-scoped spy installed above.
  const createScore = createScoreSpy;

  beforeEach(() => {
    createScore.mockReset();
    createScore.mockResolvedValue(undefined);
    // Reset serverConfig.langfuseHost to the default — individual tests
    // may override it.
    serverConfig.langfuseHost = 'http://langfuse.test';
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(401);
    expect(createScore).not.toHaveBeenCalled();
  });

  it('returns 401 before mockSession is set for any later auth call', async () => {
    // Sanity guard so a future refactor cannot silently call createScore
    // for an unauthenticated request — that would be a privacy bug.
    vi.mocked(getServerSession).mockResolvedValue(null);
    await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'down' }) as Parameters<typeof POST>[0],
    );
    expect(createScore).not.toHaveBeenCalled();
  });

  it('records a thumbs-up as value 1 and returns 204', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(204);
    expect(createScore).toHaveBeenCalledWith({
      traceId: 'trace-1',
      name: 'user-feedback',
      value: 1,
    });
  });

  it('records a thumbs-down as value 0 and returns 204', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'down' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(204);
    expect(createScore).toHaveBeenCalledWith({
      traceId: 'trace-1',
      name: 'user-feedback',
      value: 0,
    });
  });

  it('returns 400 when traceId is missing', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(createScore).not.toHaveBeenCalled();
  });

  it('returns 400 when rating is invalid', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({
        messageId: 'msg-1',
        traceId: 'trace-1',
        rating: 'maybe',
      }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(createScore).not.toHaveBeenCalled();
  });

  it('returns 400 when body is not valid JSON', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(makeRequest('not-json{') as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
    expect(createScore).not.toHaveBeenCalled();
  });

  it('returns 503 when Langfuse is unavailable', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    createScore.mockRejectedValueOnce(
      new LangfuseUnavailableError('connect ECONNREFUSED'),
    );

    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe('Feedback service unavailable');
  });

  it('returns 204 no-op when Langfuse host is not configured', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    serverConfig.langfuseHost = null;

    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(204);
    expect(createScore).not.toHaveBeenCalled();
  });
});
