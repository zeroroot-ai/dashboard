/**
 * Tests for the X-Gibson-Debug response header on POST /api/chat.
 *
 * Verifies:
 *   - Requests with X-Gibson-Debug: 1 receive X-Gibson-System-Prompt-Debug
 *     in the response headers, URL-encoded and capped at 8 KB.
 *   - Requests without the debug header do NOT receive the debug header.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetServerSession = vi.fn();
const mockListProviders = vi.fn();
const mockResolveProvider = vi.fn();
const mockBuildSystemPrompt = vi.fn();
const mockStreamText = vi.fn();
const mockGetGraphContext = vi.fn();
const mockGetGraphSummary = vi.fn();
const mockGetUserActivityContext = vi.fn();
const mockGetLangfuseUserContext = vi.fn();
const mockGetPlatformContext = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn().mockResolvedValue('tenant-1'),
  activeTenantApiResponse: vi.fn((err: unknown) => {
    return new Response(JSON.stringify({ error: 'no_active_tenant' }), { status: 412 });
  }),
  NoActiveTenantError: class extends Error { constructor() { super('no active tenant'); } },
  StaleActiveTenantError: class extends Error { constructor() { super('stale active tenant'); } },
}));

vi.mock('@/src/lib/gibson-client', () => ({
  listProviders: mockListProviders,
}));

vi.mock('@/src/lib/ai/provider', () => ({
  resolveProvider: mockResolveProvider,
}));

vi.mock('@/src/lib/ai/prompts', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

vi.mock('ai', () => ({
  streamText: mockStreamText,
  convertToModelMessages: vi.fn(async (messages: unknown[]) => messages),
}));

vi.mock('@/src/lib/graph/context', () => ({
  getGraphContext: mockGetGraphContext,
}));

vi.mock('@/src/lib/graph/summary', () => ({
  getGraphSummary: mockGetGraphSummary,
}));

vi.mock('@/src/lib/chat/user-activity-context', () => ({
  getUserActivityContext: mockGetUserActivityContext,
}));

vi.mock('@/src/lib/chat/langfuse-session-context', () => ({
  getLangfuseUserContext: mockGetLangfuseUserContext,
}));

vi.mock('@/src/lib/chat/platform-context', () => ({
  getPlatformContext: mockGetPlatformContext,
}));

vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: mockCheckRateLimit,
  createRateLimitResponse: vi.fn(),
}));

const { mockDaemonErrorResponse } = vi.hoisted(() => ({
  mockDaemonErrorResponse: vi.fn((err: unknown) => {
    // Log the error to help diagnose test failures.
    if (process.env['DEBUG_TEST']) console.error('[test] daemonErrorResponse called with:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }),
}));

vi.mock('@/src/lib/api-errors', () => ({
  validationErrorResponse: vi.fn((err: unknown) =>
    new Response(JSON.stringify({ error: String(err) }), { status: 400 }),
  ),
  daemonErrorResponse: mockDaemonErrorResponse,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_SYSTEM_PROMPT = 'You are an AI assistant\n\nYou are the General Assistant';

/** A mock streaming response that toUIMessageStreamResponse() returns. */
function makeMockStreamResult() {
  const headers = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('hello'));
      controller.close();
    },
  });
  const response = new Response(body, { status: 200, headers });
  return {
    toTextStreamResponse: () => response,
    toUIMessageStreamResponse: () => response,
  };
}

function makeRequest(opts?: { debugHeader?: boolean; messages?: unknown[] }): NextRequest {
  const messages = opts?.messages ?? [{ role: 'user', content: 'hello', id: 'm1' }];
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (opts?.debugHeader) {
    headers['X-Gibson-Debug'] = '1';
  }
  return new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ messages }),
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Set up return values BEFORE clearAllMocks so they persist after the reset.
  // The order matters: clearAllMocks clears implementations, so wire them
  // back up immediately after.
  vi.resetModules();

  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockGetServerSession.mockResolvedValue({
    user: { id: 'user-1', tenantId: 'tenant-1' },
  });
  mockListProviders.mockResolvedValue({ defaultProvider: 'anthropic' });
  mockResolveProvider.mockReturnValue({ modelId: 'claude-3-5-sonnet' });
  mockBuildSystemPrompt.mockReturnValue(MOCK_SYSTEM_PROMPT);
  mockStreamText.mockReturnValue(makeMockStreamResult());
  mockGetGraphContext.mockResolvedValue(undefined);
  mockGetGraphSummary.mockResolvedValue(null);
  mockGetUserActivityContext.mockResolvedValue({ recentMissions: [], recentNodes: [], recentFindings: [] });
  mockGetLangfuseUserContext.mockResolvedValue({ recentTraces: [] });
  mockGetPlatformContext.mockResolvedValue({ agents: [], tools: [], plugins: [] });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/chat — X-Gibson-Debug header', () => {
  it('includes X-Gibson-System-Prompt-Debug when X-Gibson-Debug: 1 is sent', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ debugHeader: true }));

    expect(res.status).toBe(200);
    const debugHeader = res.headers.get('X-Gibson-System-Prompt-Debug');
    expect(debugHeader).not.toBeNull();

    const decoded = decodeURIComponent(debugHeader!);
    expect(decoded).toBe(MOCK_SYSTEM_PROMPT);
  });

  it('does NOT include X-Gibson-System-Prompt-Debug without debug header', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ debugHeader: false }));

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Gibson-System-Prompt-Debug')).toBeNull();
  });

  it('caps debug payload at 8192 characters', async () => {
    const longPrompt = 'A'.repeat(16_000);
    mockBuildSystemPrompt.mockReturnValue(longPrompt);

    const { POST } = await import('../route');
    const res = await POST(makeRequest({ debugHeader: true }));

    expect(res.status).toBe(200);
    const debugHeader = res.headers.get('X-Gibson-System-Prompt-Debug');
    expect(debugHeader).not.toBeNull();

    const decoded = decodeURIComponent(debugHeader!);
    expect(decoded.length).toBe(8192);
    expect(decoded).toBe(longPrompt.slice(0, 8192));
  });
});
