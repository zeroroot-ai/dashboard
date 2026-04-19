/**
 * Tests for GET/POST /api/settings/providers
 *
 * Verifies:
 * - Unauthenticated requests return 401
 * - Happy paths return the daemon response
 * - ConnectErrors are translated to correct HTTP status codes
 * - Credentials never appear in response bodies
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Mocks — hoisted before imports
// ---------------------------------------------------------------------------

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    daemonListProviders: vi.fn(),
    daemonCreateProvider: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET, POST } from './route';
import { getServerSession } from '@/src/lib/auth';
import { daemonListProviders, daemonCreateProvider } from '@/src/lib/gibson-client';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockSession = {
  user: { id: 'user-1', tenantId: 'tenant-1', emailVerified: true, groups: [], roles: [], tenants: [], rolesByTenant: {}, permissions: [], crossTenant: false },
  expires: '2099-01-01T00:00:00Z',
};

const mockProvider = {
  id: 'prov-uuid-1',
  name: 'my-anthropic',
  type: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-20241022',
  isDefault: false,
  enabled: true,
  credentialsMasked: { api_key: '****abcd' },
  createdAt: '2026-04-18T00:00:00Z',
  updatedAt: '2026-04-18T00:00:00Z',
};

function makeRequest(method = 'GET', body?: unknown): Request {
  return new Request('http://localhost/api/settings/providers', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// GET /api/settings/providers
// ---------------------------------------------------------------------------

describe('GET /api/settings/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('unauthenticated');
  });

  it('returns providers list on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonListProviders).mockResolvedValue([mockProvider]);

    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toHaveLength(1);
    expect(body.providers[0].name).toBe('my-anthropic');
    // Credentials must be masked — no plaintext
    expect(body.providers[0].credentialsMasked.api_key).toBe('****abcd');
    expect(JSON.stringify(body)).not.toContain('sk-ant-api');
  });

  it.each([
    [Code.Unauthenticated, 401],
    [Code.PermissionDenied, 403],
    [Code.NotFound, 404],
    [Code.AlreadyExists, 409],
    [Code.InvalidArgument, 400],
    [Code.FailedPrecondition, 412],
    [Code.ResourceExhausted, 429],
    [Code.Unimplemented, 501],
    [Code.Unavailable, 503],
    [Code.DeadlineExceeded, 504],
    [Code.Internal, 500],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonListProviders).mockRejectedValue(
      new ConnectError('daemon error', code),
    );

    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(expectedStatus);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 500 for unexpected errors', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonListProviders).mockRejectedValue(new Error('network failure'));

    const res = await GET(makeRequest() as Parameters<typeof GET>[0]);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('internal');
  });

  it('forwards userId and tenantId to the client', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonListProviders).mockResolvedValue([]);

    await GET(makeRequest() as Parameters<typeof GET>[0]);
    expect(daemonListProviders).toHaveBeenCalledWith('user-1', 'tenant-1');
  });
});

// ---------------------------------------------------------------------------
// POST /api/settings/providers
// ---------------------------------------------------------------------------

describe('POST /api/settings/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validInput = {
    name: 'my-anthropic',
    type: 'anthropic',
    defaultModel: 'claude-3-5-sonnet-20241022',
    credentials: { api_key: 'sk-ant-api03-real-key' },
    setAsDefault: false,
  };

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);
    const res = await POST(makeRequest('POST', validInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('returns 201 with the created provider on success', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonCreateProvider).mockResolvedValue(mockProvider);

    const res = await POST(makeRequest('POST', validInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.provider.name).toBe('my-anthropic');
    // Response body must not contain plaintext credential
    expect(JSON.stringify(body)).not.toContain('sk-ant-api03-real-key');
  });

  it('returns 400 on invalid JSON body', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    const req = new Request('http://localhost/api/settings/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{',
    });
    const res = await POST(req as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it.each([
    [Code.AlreadyExists, 409],
    [Code.InvalidArgument, 400],
    [Code.FailedPrecondition, 412],
    [Code.PermissionDenied, 403],
  ])('translates ConnectError Code.%s to HTTP %i', async (code, expectedStatus) => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonCreateProvider).mockRejectedValue(
      new ConnectError('daemon error', code),
    );

    const res = await POST(makeRequest('POST', validInput) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(expectedStatus);
    // The credential from the request body must not appear in the error response
    expect(JSON.stringify(await res.json())).not.toContain('sk-ant-api03-real-key');
  });

  it('does not leak credentials in error responses', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonCreateProvider).mockRejectedValue(
      new ConnectError('already exists', Code.AlreadyExists),
    );

    const res = await POST(makeRequest('POST', validInput) as Parameters<typeof POST>[0]);
    const text = await res.text();
    expect(text).not.toContain('sk-ant-api03-real-key');
    expect(text).not.toContain('api_key');
  });

  it('forwards input to daemonCreateProvider', async () => {
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(daemonCreateProvider).mockResolvedValue(mockProvider);

    await POST(makeRequest('POST', validInput) as Parameters<typeof POST>[0]);
    expect(daemonCreateProvider).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'my-anthropic', type: 'anthropic' }),
      'user-1',
      'tenant-1',
    );
  });
});
