/**
 * Unit tests for src/lib/auth/assert-authorized.ts
 *
 * Covers all error paths per design Component 3:
 *   1. Unknown method → throws AuthzDeniedError('unknown_method')  [FAIL-CLOSED]
 *   2. Unknown method + dev escape hatch (NODE_ENV=development + DASHBOARD_AUTHZ_PERMISSIVE_DEV=1) → allow
 *   3. Unknown method + NODE_ENV=production + DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 → STILL throws (production gate)
 *   4. Warn-once: same method called twice fires warn exactly once
 *   5. unauthenticated entry → no throw (allowed)
 *   6. No session → AuthzDeniedError('no-session')
 *   7. SERVICE-only RPC → AuthzDeniedError('service-only-rpc')
 *   8. No active tenant → AuthzDeniedError('no-active-tenant')
 *   9. Not a member of active tenant → AuthzDeniedError('not-a-member')
 *  10. Role below required relation → AuthzDeniedError('relation-not-met')
 *  11. admin satisfies member → no throw
 *  12. member satisfies member → no throw
 *  13. Membership resolution failure → AuthzDeniedError('not-a-member')
 *
 * Spec: dashboard-authz-ui-gating Requirement 3, 9.2.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AuthzDeniedError, assertAuthorized } from '../assert-authorized';

// ---------------------------------------------------------------------------
// Mocks — hoisted before any imports
// ---------------------------------------------------------------------------

vi.mock('@/src/gen/authz/registry', () => ({
  IdentityClass: { USER: 1, SERVICE: 2, COMPONENT: 4, PLATFORM_OPERATOR: 8 } as const,
  AuthRegistry: {
    '/test/AdminService/AdminMethod': {
      method: '/test/AdminService/AdminMethod',
      service: 'test.AdminService',
      relation: 'admin',
      objectType: 'tenant',
      objectDeriver: 'tenant_from_identity',
      allowedIdentities: 1, // USER only
      unauthenticated: false,
    },
    '/test/MemberService/MemberMethod': {
      method: '/test/MemberService/MemberMethod',
      service: 'test.MemberService',
      relation: 'member',
      objectType: 'tenant',
      objectDeriver: 'tenant_from_identity',
      allowedIdentities: 1,
      unauthenticated: false,
    },
    '/test/PublicService/PingMethod': {
      method: '/test/PublicService/PingMethod',
      service: 'test.PublicService',
      relation: '',
      objectType: '',
      objectDeriver: '',
      allowedIdentities: 1,
      unauthenticated: true,
    },
    '/test/ServiceOnlyService/InternalMethod': {
      method: '/test/ServiceOnlyService/InternalMethod',
      service: 'test.ServiceOnlyService',
      relation: 'platform_operator',
      objectType: 'system_tenant',
      objectDeriver: 'system_tenant',
      allowedIdentities: 2, // SERVICE only
      unauthenticated: false,
    },
  } as Record<string, import('@/src/gen/authz/registry').AuthEntry>,
}));

// Mock auth() — must be a default export factory
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

// Mock getMyMemberships
vi.mock('@/src/lib/auth/membership', () => ({
  getMyMemberships: vi.fn(),
}));

// Mock readRawActiveTenant
vi.mock('@/src/lib/auth/active-tenant', () => ({
  readRawActiveTenant: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { auth } from '@/auth';
import { getMyMemberships } from '@/src/lib/auth/membership';
import { readRawActiveTenant } from '@/src/lib/auth/active-tenant';

const mockAuth = vi.mocked(auth);
const mockGetMyMemberships = vi.mocked(getMyMemberships);
const mockReadRawActiveTenant = vi.mocked(readRawActiveTenant);

function setupSession(id = 'user-123') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockAuth.mockResolvedValue({ user: { id }, expires: '' } as any);
}

function setupNoSession() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockAuth.mockResolvedValue(null as any);
}

function setupActiveTenant(tenantId: string) {
  mockReadRawActiveTenant.mockResolvedValue({ status: 'present', tenantId });
}

function setupNoActiveTenant() {
  mockReadRawActiveTenant.mockResolvedValue({ status: 'absent' });
}

function setupMemberships(tenantId: string, role: 'owner' | 'admin' | 'member') {
  mockGetMyMemberships.mockResolvedValue([
    { tenantId, tenantName: tenantId, role },
  ]);
}

function setupMembershipsError() {
  mockGetMyMemberships.mockRejectedValue(new Error('daemon_unavailable'));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: happy path — admin on tenant-a.
  setupSession();
  setupActiveTenant('tenant-a');
  setupMemberships('tenant-a', 'admin');
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fail-closed: unknown method tests (cross-repo-cohesion-fixes Requirement 1)
// ---------------------------------------------------------------------------

describe('assertAuthorized — unknown method (fail-closed)', () => {
  it('(a) throws AuthzDeniedError with code unknown_method for an unrecognised method', async () => {
    await expect(assertAuthorized('/unknown/Service/FailClosed')).rejects.toThrow(AuthzDeniedError);
    await expect(assertAuthorized('/unknown/Service/FailClosed2')).rejects.toMatchObject({
      reason: 'unknown_method',
      method: '/unknown/Service/FailClosed2',
    });
  });
});

describe('assertAuthorized — unknown method dev escape hatch', () => {
  afterEach(() => {
    // vi.unstubAllEnvs restores all env stubs set via vi.stubEnv — prevents leakage.
    vi.unstubAllEnvs();
  });

  it('(b) NODE_ENV=development + DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 allows the call through', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    // Method names are unique to avoid hitting the warn-once memo from other tests.
    await expect(assertAuthorized('/unknown/EscapeHatch/Allow')).resolves.toBeUndefined();
  });

  it('(c) NODE_ENV=production + DASHBOARD_AUTHZ_PERMISSIVE_DEV=1 STILL throws (production gate)', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    await expect(assertAuthorized('/unknown/EscapeHatch/ProductionDeny')).rejects.toMatchObject({
      reason: 'unknown_method',
    });
  });

  it('(d) warn log fires exactly once for the same method called twice under dev escape hatch', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DASHBOARD_AUTHZ_PERMISSIVE_DEV', '1');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await assertAuthorized('/unknown/WarnOnce/Method');
      await assertAuthorized('/unknown/WarnOnce/Method');
      // The Map memoises on first call; second call skips the warn.
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logArg: string = warnSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(logArg) as Record<string, unknown>;
      expect(parsed).toMatchObject({ event: 'authz_registry_miss', method: '/unknown/WarnOnce/Method' });
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('assertAuthorized — unauthenticated entry', () => {
  it('does not throw for a public RPC', async () => {
    await expect(assertAuthorized('/test/PublicService/PingMethod')).resolves.toBeUndefined();
  });

  it('does not consult auth() for a public RPC', async () => {
    await assertAuthorized('/test/PublicService/PingMethod');
    expect(mockAuth).not.toHaveBeenCalled();
  });
});

describe('assertAuthorized — no session', () => {
  it('throws AuthzDeniedError with reason no-session', async () => {
    setupNoSession();
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toThrow(
      AuthzDeniedError,
    );
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toMatchObject({
      method: '/test/AdminService/AdminMethod',
      reason: 'no-session',
    });
  });
});

describe('assertAuthorized — service-only RPC', () => {
  it('throws AuthzDeniedError with reason service-only-rpc', async () => {
    await expect(assertAuthorized('/test/ServiceOnlyService/InternalMethod')).rejects.toMatchObject({
      reason: 'service-only-rpc',
      method: '/test/ServiceOnlyService/InternalMethod',
    });
  });
});

describe('assertAuthorized — no active tenant', () => {
  it('throws AuthzDeniedError with reason no-active-tenant', async () => {
    setupNoActiveTenant();
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toMatchObject({
      reason: 'no-active-tenant',
    });
  });
});

describe('assertAuthorized — not a member', () => {
  it('throws not-a-member when memberships list is empty for active tenant', async () => {
    setupActiveTenant('tenant-b');
    setupMemberships('tenant-a', 'admin'); // wrong tenant
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toMatchObject({
      reason: 'not-a-member',
    });
  });

  it('throws not-a-member when membership resolution throws', async () => {
    setupMembershipsError();
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toMatchObject({
      reason: 'not-a-member',
    });
  });
});

describe('assertAuthorized — relation-not-met', () => {
  it('throws relation-not-met when member tries an admin-only method', async () => {
    setupMemberships('tenant-a', 'member');
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).rejects.toMatchObject({
      reason: 'relation-not-met',
      method: '/test/AdminService/AdminMethod',
    });
  });
});

describe('assertAuthorized — allowed paths', () => {
  it('resolves for admin on a admin method', async () => {
    setupMemberships('tenant-a', 'admin');
    await expect(assertAuthorized('/test/AdminService/AdminMethod')).resolves.toBeUndefined();
  });

  it('resolves for admin on a member method (hierarchy: admin > member)', async () => {
    setupMemberships('tenant-a', 'admin');
    await expect(assertAuthorized('/test/MemberService/MemberMethod')).resolves.toBeUndefined();
  });

  it('resolves for member on a member method', async () => {
    setupMemberships('tenant-a', 'member');
    await expect(assertAuthorized('/test/MemberService/MemberMethod')).resolves.toBeUndefined();
  });
});

describe('AuthzDeniedError class', () => {
  it('carries method and reason fields', () => {
    const err = new AuthzDeniedError('/my/method', 'no-session');
    expect(err.method).toBe('/my/method');
    expect(err.reason).toBe('no-session');
    expect(err.name).toBe('AuthzDeniedError');
    expect(err instanceof AuthzDeniedError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('error message contains method and reason but NOT role / tenant data', () => {
    const err = new AuthzDeniedError('/my/method', 'relation-not-met');
    // Message only carries the reason and method — never role lists or tenant IDs.
    expect(err.message).toContain('/my/method');
    expect(err.message).toContain('relation-not-met');
    // Sanity: message should be short and structured — no dynamic tenant data.
    expect(err.message).not.toMatch(/tenant-|user-|role:/);
  });
});
