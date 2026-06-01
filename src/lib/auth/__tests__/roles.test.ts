/**
 * Unit tests for src/lib/auth/roles.ts
 *
 * Covers:
 *   - ROLE_RANK is correctly ordered (owner > admin > member)
 *   - hasRoleAtLeast full permission matrix: owner/admin/member/unknown/null-session
 *   - Unknown role strings are treated as rank 0 (deny)
 *   - Missing tenantId key in rolesByTenant returns false
 */

import { describe, it, expect } from 'vitest';
import { ROLE_RANK, hasRoleAtLeast, type TenantRole } from '../roles';
import type { GibsonSession } from '@/src/lib/auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(rolesByTenant: Record<string, string>): GibsonSession {
  return {
    user: {
      id: 'u1',
      name: 'Test User',
      email: 'test@example.com',
      image: null,
      emailVerified: true,
      groups: [],
      roles: [],
      tenants: Object.keys(rolesByTenant),
      rolesByTenant,
      crossTenant: false,
    },
    expires: new Date(Date.now() + 86400_000).toISOString(),
  };
}

const TENANT = 'tenant-a';

// ---------------------------------------------------------------------------
// ROLE_RANK
// ---------------------------------------------------------------------------

describe('ROLE_RANK', () => {
  it('encodes owner > admin > member', () => {
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.member);
    expect(ROLE_RANK.member).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — null / missing session
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — null/undefined session', () => {
  const checks: TenantRole[] = ['member', 'admin', 'owner'];

  it('returns false for null session', () => {
    for (const role of checks) {
      expect(hasRoleAtLeast(null, TENANT, role)).toBe(false);
    }
  });

  it('returns false for undefined session', () => {
    for (const role of checks) {
      expect(hasRoleAtLeast(undefined, TENANT, role)).toBe(false);
    }
  });

  it('returns false when tenantId is absent from rolesByTenant', () => {
    const session = makeSession({ 'other-tenant': 'owner' });
    for (const role of checks) {
      expect(hasRoleAtLeast(session, TENANT, role)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — owner passes all checks
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — owner', () => {
  const session = makeSession({ [TENANT]: 'owner' });

  it('passes member check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'member')).toBe(true);
  });

  it('passes admin check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'admin')).toBe(true);
  });

  it('passes owner check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'owner')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — admin passes member/admin, fails owner
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — admin', () => {
  const session = makeSession({ [TENANT]: 'admin' });

  it('passes member check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'member')).toBe(true);
  });

  it('passes admin check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'admin')).toBe(true);
  });

  it('fails owner check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — member passes member only
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — member', () => {
  const session = makeSession({ [TENANT]: 'member' });

  it('passes member check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'member')).toBe(true);
  });

  it('fails admin check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'admin')).toBe(false);
  });

  it('fails owner check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — unknown role string is deny
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — unknown role string', () => {
  const session = makeSession({ [TENANT]: 'superuser' });

  it('fails member check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'member')).toBe(false);
  });

  it('fails admin check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'admin')).toBe(false);
  });

  it('fails owner check', () => {
    expect(hasRoleAtLeast(session, TENANT, 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hasRoleAtLeast — multiple tenants
// ---------------------------------------------------------------------------

describe('hasRoleAtLeast — per-tenant isolation', () => {
  const session = makeSession({
    'tenant-a': 'member',
    'tenant-b': 'owner',
  });

  it('member in tenant-a cannot pass admin check for tenant-a', () => {
    expect(hasRoleAtLeast(session, 'tenant-a', 'admin')).toBe(false);
  });

  it('owner in tenant-b passes owner check for tenant-b', () => {
    expect(hasRoleAtLeast(session, 'tenant-b', 'owner')).toBe(true);
  });

  it('owner in tenant-b does NOT grant any role in tenant-a', () => {
    expect(hasRoleAtLeast(session, 'tenant-a', 'owner')).toBe(false);
  });
});
