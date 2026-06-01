/**
 * Tests for POST /api/settings/providers/test
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy path returns the daemon test result
 * - ConnectErrors are translated to correct HTTP status codes
 * - Credentials never appear in response bodies (even on error)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  requireActiveTenant: vi.fn(),
  activeTenantApiResponse: vi.fn((err: unknown) => {
    return Response.json({ error: 'no_active_tenant', code: 'no_active_tenant' }, { status: 412 });
  }),
  NoActiveTenantError: class extends Error { constructor() { super('no active tenant'); } },
  StaleActiveTenantError: class extends Error { constructor() { super('stale active tenant'); } },
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    daemonTestProvider: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { POST } from './route';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant } from '@/src/lib/auth/active-tenant';
import { daemonTestProvider } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: { id: 'user-1', tenantId: 'tenant-1', emailVerified: true, groups: [], roles: [], tenants: [], rolesByTenant: {}, permissions: [], crossTenant: false },
  expires: '2099-01-01T00:00:00Z',
};

const testInput = {
  name: 'test-anthropic',
  type: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-20241022',
  credentials: { api_key: 'sk-ant-api03-plaintext-secret' },
};

const mockTestResult = {
  ok: true,
  latencyMs: 342,
  model: 'claude-3-5-sonnet-20241022',
  error: undefined,
  models: [],
};

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/settings/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/settings/providers/test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireActiveTenant).mockResolvedValue('tenant-1');
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('returns the structured test result on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockResolvedValue(mockTestResult);

    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.ok).toBe(true);
    expect(body.result.latencyMs).toBe(342);
    // Plaintext credentials must NOT appear in the response
    expect(JSON.stringify(body)).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('returns {ok:false} result for failed upstream connection', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockResolvedValue({
      ok: false,
      latencyMs: 5001,
      model: '',
      error: 'authentication failed',
      models: [],
    });

    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.ok).toBe(false);
    expect(body.result.error).toBe('authentication failed');
    // Still must not leak the credential
    expect(JSON.stringify(body)).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('returns 429 on rate limit (ResourceExhausted)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockRejectedValue(
      new ConnectError('rate limited; retry after 60s', Code.ResourceExhausted),
    );

    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(429);
    // No credential leakage
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const req = new Request('http://localhost/api/settings/providers/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{{',
    });
    const res = await POST(req as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it.each([
    [Code.PermissionDenied, 403],
    [Code.InvalidArgument, 400],
    [Code.Unavailable, 503],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockRejectedValue(new ConnectError('error', code));

    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(expectedStatus);
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('does not log credential material in the response body on any error', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockRejectedValue(new Error('network failure'));

    const res = await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    const text = await res.text();
    // The plaintext api_key must never appear in any response
    expect(text).not.toContain('sk-ant-api03-plaintext-secret');
  });

  it('forwards input to daemonTestProvider (not persisted)', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonTestProvider).mockResolvedValue(mockTestResult);

    await POST(makeRequest(testInput) as Parameters<typeof POST>[0]);
    expect(daemonTestProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-anthropic', type: 'anthropic' }),
      'user-1',
      'tenant-1',
    );
  });
});
