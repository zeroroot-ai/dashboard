/**
 * Unit tests for POST /api/agents/register.
 *
 * Spec: unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8).
 *
 * Coverage:
 *   - 401 Unauthorized when there's no session.
 *   - 412 NO_ACTIVE_TENANT when the active-tenant cookie is missing.
 *   - 403 FORBIDDEN when the caller is a tenant member but not admin.
 *   - 400 INVALID_REQUEST on missing/invalid name.
 *   - 201 happy path returns the credentials shape with the matching
 *     pre-filled enroll command and `Cache-Control: no-store`.
 *   - 502 ZITADEL_FAILED on Zitadel error → message is sanitized
 *     (no PAT / secret leakage).
 *   - The success path never threads the secret through any logger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Vitest module mocks. All factory functions are typed as returning the
// objects the route imports — keeping the route's import surface in one
// place avoids "module not mocked" surprises.
// ---------------------------------------------------------------------------

const mockAuth = vi.fn();
const mockGetServerSession = vi.fn();
const mockGetActiveTenant = vi.fn();
const mockHasRoleAtLeast = vi.fn();
const mockCreateMachineUser = vi.fn();
const mockAddMachineSecret = vi.fn();
const mockAddProjectMember = vi.fn();
const mockGetSignupZitadelAdminClient = vi.fn();

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

vi.mock('@/src/lib/zitadel/admin-client-factory', () => ({
  getSignupZitadelAdminClient: mockGetSignupZitadelAdminClient,
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

/** Wire up a fake Zitadel client whose three methods are pre-mocked. */
function installZitadelClient() {
  mockGetSignupZitadelAdminClient.mockReturnValue({
    createMachineUser: mockCreateMachineUser,
    addMachineSecret: mockAddMachineSecret,
    addProjectMember: mockAddProjectMember,
  });
}

beforeEach(() => {
  vi.resetModules();
  mockAuth.mockReset();
  mockGetServerSession.mockReset();
  mockGetActiveTenant.mockReset();
  mockHasRoleAtLeast.mockReset();
  mockCreateMachineUser.mockReset();
  mockAddMachineSecret.mockReset();
  mockAddProjectMember.mockReset();
  mockGetSignupZitadelAdminClient.mockReset();
});

// ---------------------------------------------------------------------------
// 401 — no session
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — auth gate', () => {
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
// 412 — no active tenant
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — tenant gate', () => {
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
// 403 — non-admin role
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — role gate', () => {
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
    // The role gate decision was actually consulted with the resolved
    // tenant + minimum role — without this the test would silently pass
    // even if we wired up the gate wrong.
    expect(mockHasRoleAtLeast).toHaveBeenCalledWith(expect.anything(), 'acme', 'admin');
  });
});

// ---------------------------------------------------------------------------
// 400 — bad input
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — input validation', () => {
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
// 201 — happy path
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — happy path', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    mockHasRoleAtLeast.mockReturnValue(true);
    installZitadelClient();
  });

  it('creates machine user, mints secret, adds project member, returns credentials', async () => {
    mockCreateMachineUser.mockResolvedValue({
      userId: 'svc-acct-123',
      username: 'agent-acme-redteam-1',
    });
    mockAddMachineSecret.mockResolvedValue({
      clientId: 'cid-abc',
      clientSecret: 'csecret-xyz',
    });
    mockAddProjectMember.mockResolvedValue(undefined);

    const { POST } = await import('../route');
    const res = await POST(
      makeRequest({ name: 'redteam-1', description: 'nightly runner' }),
    );

    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const body = await res.json();
    expect(body).toEqual({
      clientId: 'cid-abc',
      clientSecret: 'csecret-xyz',
      gibsonUrl: 'https://api.zero-day.local:30443',
      enrollCommand:
        'gibson-cli agent enroll --client-id cid-abc --client-secret csecret-xyz --gibson-url https://api.zero-day.local:30443',
    });

    // The username Zitadel sees must be tenant-namespaced.
    expect(mockCreateMachineUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'agent-acme-redteam-1',
        name: 'redteam-1',
        description: 'nightly runner',
      }),
    );
    // The freshly-minted Zitadel user ID must propagate into the
    // project-member call.
    expect(mockAddProjectMember).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'svc-acct-123',
        roles: ['agent'],
      }),
    );
  });

  it('honors ENVOY_PUBLIC_URL override', async () => {
    const prev = process.env.ENVOY_PUBLIC_URL;
    process.env.ENVOY_PUBLIC_URL = 'https://api.acme.example';
    try {
      mockCreateMachineUser.mockResolvedValue({
        userId: 'svc-1',
        username: 'agent-acme-x',
      });
      mockAddMachineSecret.mockResolvedValue({
        clientId: 'cid-1',
        clientSecret: 'csec-1',
      });
      mockAddProjectMember.mockResolvedValue(undefined);

      const { POST } = await import('../route');
      const res = await POST(makeRequest({ name: 'x' }));
      const body = await res.json();
      expect(body.gibsonUrl).toBe('https://api.acme.example');
      expect(body.enrollCommand).toContain('--gibson-url https://api.acme.example');
    } finally {
      if (prev === undefined) delete process.env.ENVOY_PUBLIC_URL;
      else process.env.ENVOY_PUBLIC_URL = prev;
    }
  });

  it('never logs the client secret on the success path', async () => {
    mockCreateMachineUser.mockResolvedValue({
      userId: 'svc-1',
      username: 'agent-acme-x',
    });
    mockAddMachineSecret.mockResolvedValue({
      clientId: 'cid-1',
      clientSecret: 'topsecret-do-not-leak',
    });
    mockAddProjectMember.mockResolvedValue(undefined);

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
// 502 — Zitadel error sanitisation
// ---------------------------------------------------------------------------

describe('POST /api/agents/register — Zitadel failures', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: 'u1' } });
    mockGetActiveTenant.mockResolvedValue('acme');
    mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
    mockHasRoleAtLeast.mockReturnValue(true);
    installZitadelClient();
  });

  it('returns 502 ZITADEL_FAILED with sanitized message on Zitadel 500', async () => {
    const { ZitadelApiError } = await import('@/src/lib/zitadel/errors');
    mockCreateMachineUser.mockRejectedValue(
      new ZitadelApiError(500, 'INTERNAL', 'thing exploded'),
    );

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { POST } = await import('../route');
      const res = await POST(makeRequest({ name: 'x' }));
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.code).toBe('ZITADEL_FAILED');
      // The user-facing message must NOT echo internal Zitadel detail.
      expect(body.error.message).not.toContain('thing exploded');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('returns 409 AGENT_EXISTS on Zitadel 409', async () => {
    const { ZitadelApiError } = await import('@/src/lib/zitadel/errors');
    mockCreateMachineUser.mockRejectedValue(
      new ZitadelApiError(409, 'ALREADY_EXISTS', 'username exists'),
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
});
