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

// Mock at the LangfuseClient class boundary so we can spy on createScore
// without spinning up an HTTP fetch.
vi.mock('@/src/lib/langfuse-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/langfuse-client')>();
  return {
    ...actual,
    LangfuseClient: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from '../route';
import { getServerSession } from '@/src/lib/auth';
import { LangfuseClient, LangfuseUnavailableError } from '@/src/lib/langfuse-client';
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
  let createScore: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    createScore = vi.fn().mockResolvedValue(undefined);
    vi.mocked(LangfuseClient).mockImplementation(
      () => ({ createScore }) as unknown as LangfuseClient,
    );
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

  it('records a thumbs-up as value 1 and returns 204', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const res = await POST(
      makeRequest({ messageId: 'msg-1', traceId: 'trace-1', rating: 'up' }) as Parameters<typeof POST>[0],
    );
    if (res.status !== 204) {
      console.error('Body:', await res.clone().text());
    }
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
    expect(LangfuseClient).not.toHaveBeenCalled();
    expect(createScore).not.toHaveBeenCalled();
  });
});
