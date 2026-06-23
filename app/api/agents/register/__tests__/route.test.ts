/**
 * Unit tests for POST /api/agents/register.
 *
 * Spec: agent-service-credentials (Task 16).
 *
 * Coverage:
 *   - 401 Unauthorized when there's no session.
 *   - 412 NO_ACTIVE_TENANT when the active-tenant cookie is missing.
 *   - 403 FORBIDDEN when the caller is a tenant member but not admin.
 *   - 400 INVALID_REQUEST on missing/invalid name.
 *   - 201 happy path returns the credentials shape with the pre-filled
 *     enroll command and `Cache-Control: no-store`.
 *   - 409 AGENT_EXISTS when daemon returns AlreadyExists.
 *   - 502 DAEMON_ERROR on daemon Internal error.
 *   - The success path never threads the secret through any logger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Vitest module mocks
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
const mockGetServerSession = vi.fn();
const mockGetActiveTenant = vi.fn();
const mockHasRoleAtLeast = vi.fn();
const mockCreateAgentIdentity = vi.fn();

vi.mock('@/auth', () => ({
  auth: mockAuth,
}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/auth/active-tenant', () => ({
  getActiveTenant: mockGetActiveTenant,
}));

vi.mock('@/src/lib/auth/roles', () => ({
  hasRoleAtLeast: mockHasRoleAtLeast,
}));

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => ({
    createAgentIdentity: mockCreateAgentIdentity,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal NextRequest that the route handler can JSON-parse. */
function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://test.local/api/agents/register', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.resetModules();
  mockAuth.mockReset();
  mockGetServerSession.mockReset();
  mockGetActiveTenant.mockReset();
  mockHasRoleAtLeast.mockReset();
  mockCreateAgentIdentity.mockReset();
});

// ---------------------------------------------------------------------------
// 401, no session
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, auth gate', () => {
  it('returns 401 when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ name: 'redteam-1' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });
});

// ---------------------------------------------------------------------------
// 412, no active tenant
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, tenant gate', () => {
  it('returns 412 when getActiveTenant throws', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockRejectedValue(
      Object.assign(new Error('no cookie'), { name: 'NoActiveTenantError' }),
    );
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ name: 'redteam-1' }));
    expect(res.status).toBe(412);
    const body = await res.json();
    expect(body.error.code).toBe('NO_ACTIVE_TENANT');
  });
});

// ---------------------------------------------------------------------------
// 403, non-admin role
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, role gate', () => {
  it('returns 403 when caller has only member role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({
      user: {
        id: 'u1',
        rolesByTenant: { acme: 'member' },
      },
    });
    mockHasRoleAtLeast.mockReturnValue(false);
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ name: 'redteam-1' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockHasRoleAtLeast).toHaveBeenCalledWith(expect.anything(), 'acme', 'admin');
  });
});

// ---------------------------------------------------------------------------
// 400, bad input
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, input validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    mockHasRoleAtLeast.mockReturnValue(true);
  });

  it('returns 400 when name is missing', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 when name has invalid characters', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest({ name: 'Bad Name!' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_REQUEST');
  });

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await import('../route');
    const res = await POST(makeRequest('not-json{'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 201, happy path
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, happy path', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    mockHasRoleAtLeast.mockReturnValue(true);
  });

  it('calls daemon CreateAgentIdentity and returns credentials', async () => {
    mockCreateAgentIdentity.mockResolvedValue({
      principalId: 'agent_principal:uuid-123',
      bootstrapToken: 'bt-abc',
      gibsonUrl: 'https://api.zeroroot.local:30443',
      enrollCommand:
        'gibson component register --kind agent --token - --gibson-url https://api.zeroroot.local:30443',
    });

    const { POST } = await import('../route');
    const res = await POST(
      makeRequest({ name: 'redteam-1', description: 'nightly runner' }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const body = await res.json();
    expect(body).toEqual({
      bootstrapToken: 'bt-abc',
      gibsonUrl: 'https://api.zeroroot.local:30443',
      enrollCommand:
        'gibson component register --kind agent --token - --gibson-url https://api.zeroroot.local:30443',
    });

    // Verify the daemon received the correct input.
    expect(mockCreateAgentIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'redteam-1',
        description: 'nightly runner',
      }),
    );
  });

  it('never logs the bootstrap token on the success path', async () => {
    mockCreateAgentIdentity.mockResolvedValue({
      principalId: 'agent_principal:uuid-1',
      bootstrapToken: 'topsecret-do-not-leak',
      gibsonUrl: 'https://api.zeroroot.local:30443',
      enrollCommand: 'gibson component register --kind agent --token - ...',
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { POST } = await import('../route');
      await POST(makeRequest({ name: 'x' }));

      const all = [
        ...logSpy.mock.calls,
        ...errSpy.mock.calls,
        ...warnSpy.mock.calls,
      ]
        .flat()
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
      for (const line of all) {
        expect(line).not.toContain('topsecret-do-not-leak');
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Daemon error mapping
// ---------------------------------------------------------------------------

describe('POST /api/agents/register, daemon error mapping', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    mockHasRoleAtLeast.mockReturnValue(true);
  });

  it('returns 409 AGENT_EXISTS on AlreadyExists from daemon', async () => {
    mockCreateAgentIdentity.mockRejectedValue(
      new ConnectError('name already in use', Code.AlreadyExists),
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ name: 'x' }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('AGENT_EXISTS');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('returns 502 DAEMON_ERROR on Internal from daemon', async () => {
    mockCreateAgentIdentity.mockRejectedValue(
      new ConnectError('internal error', Code.Internal),
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ name: 'x' }));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe('DAEMON_ERROR');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('returns 503 DAEMON_UNAVAILABLE on Unavailable from daemon', async () => {
    mockCreateAgentIdentity.mockRejectedValue(
      new ConnectError('service unavailable', Code.Unavailable),
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ name: 'x' }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error.code).toBe('DAEMON_UNAVAILABLE');
    } finally {
      errSpy.mockRestore();
    }
  });
});
