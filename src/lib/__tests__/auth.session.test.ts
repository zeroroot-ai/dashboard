/**
 * Integration-style unit tests for _getEnrichedSession in src/lib/auth.ts.
 *
 * Verifies that:
 *   1. rolesByTenant is populated from the actual member row role — NOT the
 *      former hard-coded 'admin'.
 *   2. A user who is 'member' in org-1 and 'owner' in org-2 gets both roles
 *      correctly stored.
 *   3. The deprecated hard-coded 'admin' path is gone.
 *
 * Mocking strategy
 * ----------------
 * We cannot import `_getEnrichedSession` directly (it is not exported).
 * Instead we call the public `getServerSession()` and stub the three
 * dependencies it reaches:
 *   - `next/headers`  → returns a mock headers object
 *   - `@/src/lib/auth-server` → returns a synthetic raw session
 *   - `better-auth/plugins/organization` → returns a fake orgAdapter
 *   - `@/src/lib/auth/schema` → stubs resolveEffectivePermissions / resolveCrossTenant
 *
 * Because getServerSession uses React cache() internally we must reset the
 * module between tests via vi.resetModules().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const USER_ID = 'user-abc';
const SESSION_TOKEN = 'tok-xyz';
const EXPIRES_AT = new Date('2099-01-01T00:00:00Z');

/** A raw Better Auth session response shape */
function makeRawSession(activeOrgId?: string | null) {
  return {
    session: {
      token: SESSION_TOKEN,
      expiresAt: EXPIRES_AT,
      activeOrganizationId: activeOrgId ?? null,
    },
    user: {
      id: USER_ID,
      name: 'Alice',
      email: 'alice@example.com',
      image: null,
    },
  };
}

/** Build a minimal org object returned by listOrganizations */
function makeOrg(id: string, slug: string) {
  return { id, slug, name: slug, createdAt: new Date() };
}

/** Build a minimal member object returned by findMemberByOrgId */
function makeMember(role: string) {
  return { id: 'm1', userId: USER_ID, role, createdAt: new Date() };
}

// ---------------------------------------------------------------------------
// Helpers to set up per-test module mocks
// ---------------------------------------------------------------------------

async function setupAndGetSession({
  orgs,
  memberRoleByOrgId,
  activeOrgId,
}: {
  orgs: Array<{ id: string; slug: string }>;
  memberRoleByOrgId: Record<string, string>;
  activeOrgId?: string | null;
}) {
  // Reset module registry so React cache() creates a fresh closure.
  vi.resetModules();

  // 1. Mock next/headers
  vi.doMock('next/headers', () => ({
    headers: vi.fn().mockResolvedValue(new Headers()),
  }));

  // 2. Mock auth-server
  vi.doMock('@/src/lib/auth-server', () => ({
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue(makeRawSession(activeOrgId)),
      },
      $context: Promise.resolve({}),
    },
  }));

  // 3. Mock org adapter
  const mockFindMemberByOrgId = vi.fn(
    ({ organizationId }: { userId: string; organizationId: string }) => {
      const role = memberRoleByOrgId[organizationId];
      return Promise.resolve(role ? makeMember(role) : null);
    },
  );

  vi.doMock('better-auth/plugins/organization', () => ({
    getOrgAdapter: () => ({
      listOrganizations: vi.fn().mockResolvedValue(orgs.map((o) => makeOrg(o.id, o.slug))),
      findMemberByOrgId: mockFindMemberByOrgId,
    }),
  }));

  // 4. Mock schema helpers
  vi.doMock('@/src/lib/auth/schema', () => ({
    resolveEffectivePermissions: vi.fn().mockResolvedValue([]),
    resolveCrossTenant: vi.fn().mockResolvedValue(false),
  }));

  // Import AFTER all mocks are in place
  const { getServerSession } = await import('@/src/lib/auth');
  return getServerSession();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getServerSession — rolesByTenant reflects actual member roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores member role for org-1 and owner role for org-2', async () => {
    const session = await setupAndGetSession({
      orgs: [
        { id: 'org-1-id', slug: 'org-1' },
        { id: 'org-2-id', slug: 'org-2' },
      ],
      memberRoleByOrgId: {
        'org-1-id': 'member',
        'org-2-id': 'owner',
      },
      activeOrgId: 'org-1',
    });

    expect(session).not.toBeNull();
    expect(session!.user.rolesByTenant['org-1']).toBe('member');
    expect(session!.user.rolesByTenant['org-2']).toBe('owner');
  });

  it('does NOT hard-code admin — a real member stays member', async () => {
    const session = await setupAndGetSession({
      orgs: [{ id: 'org-id', slug: 'my-org' }],
      memberRoleByOrgId: { 'org-id': 'member' },
    });

    expect(session!.user.rolesByTenant['my-org']).toBe('member');
    // Explicitly assert the old hard-coded value is absent
    expect(session!.user.rolesByTenant['my-org']).not.toBe('admin');
  });

  it('does NOT hard-code admin — a real owner stays owner', async () => {
    const session = await setupAndGetSession({
      orgs: [{ id: 'org-id', slug: 'my-org' }],
      memberRoleByOrgId: { 'org-id': 'owner' },
    });

    expect(session!.user.rolesByTenant['my-org']).toBe('owner');
  });

  it('falls back to member when findMemberByOrgId returns null', async () => {
    const session = await setupAndGetSession({
      orgs: [{ id: 'org-id', slug: 'my-org' }],
      memberRoleByOrgId: {}, // no entry → null member row
    });

    // null member row → defaults to 'member' (the ?? 'member' fallback)
    expect(session!.user.rolesByTenant['my-org']).toBe('member');
  });

  it('populates tenants list from orgs', async () => {
    const session = await setupAndGetSession({
      orgs: [
        { id: 'org-1-id', slug: 'org-1' },
        { id: 'org-2-id', slug: 'org-2' },
      ],
      memberRoleByOrgId: {
        'org-1-id': 'admin',
        'org-2-id': 'member',
      },
    });

    expect(session!.user.tenants).toContain('org-1');
    expect(session!.user.tenants).toContain('org-2');
  });

  it('returns null when auth.api.getSession returns null', async () => {
    vi.resetModules();

    vi.doMock('next/headers', () => ({
      headers: vi.fn().mockResolvedValue(new Headers()),
    }));

    vi.doMock('@/src/lib/auth-server', () => ({
      auth: {
        api: { getSession: vi.fn().mockResolvedValue(null) },
        $context: Promise.resolve({}),
      },
    }));

    const { getServerSession } = await import('@/src/lib/auth');
    const session = await getServerSession();
    expect(session).toBeNull();
  });
});
