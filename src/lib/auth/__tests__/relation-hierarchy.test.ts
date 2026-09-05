/**
 * Unit tests for src/lib/auth/relation-hierarchy.ts
 *
 * Covers the full satisfiesRelation matrix:
 *   - admin satisfies admin (same tier)
 *   - admin satisfies member (higher tier satisfies lower)
 *   - member satisfies member (same tier)
 *   - member does NOT satisfy admin (lower tier fails higher)
 *   - unknown user role returns false (tier 0 < any known tier)
 *   - unknown required relation returns false (Infinity required)
 *   - both unknown returns false
 *
 * Spec: dashboard-authz-ui-gating Requirement 4.
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';
import {
  satisfiesRelation,
  relationHierarchy,
  objectScopedRelations,
  rolesAreCrossTenant,
  scopeOfEntry,
  decideAuthEntry,
} from '../relation-hierarchy';

/** The most privileged tenant-scoped roles, the ones that used to satisfy everything. */
const TOP_TENANT_ROLES = ['owner', 'admin'] as const;

/** A secret the caller's tenant owns, named by a request field. */
const SECRET_ENTRY = {
  relation: 'can_resolve',
  objectType: 'secret',
  objectDeriver: "tenant_and_field('Name')",
};

/** The caller's own tenant, derived from their identity. */
const OWN_TENANT_ADMIN_ENTRY = {
  relation: 'admin',
  objectType: 'tenant',
  objectDeriver: 'tenant_from_identity',
};

describe('satisfiesRelation, hierarchy ordering', () => {
  it('owner satisfies admin (owner implies admin)', () => {
    expect(satisfiesRelation('owner', 'admin')).toBe(true);
  });

  it('owner satisfies member (owner implies member)', () => {
    expect(satisfiesRelation('owner', 'member')).toBe(true);
  });

  it('owner satisfies owner (same tier)', () => {
    expect(satisfiesRelation('owner', 'owner')).toBe(true);
  });

  it('admin does NOT satisfy owner (admin does not imply owner)', () => {
    expect(satisfiesRelation('admin', 'owner')).toBe(false);
  });

  it('admin satisfies admin (same tier)', () => {
    expect(satisfiesRelation('admin', 'admin')).toBe(true);
  });

  it('admin satisfies member (higher tier implies lower)', () => {
    expect(satisfiesRelation('admin', 'member')).toBe(true);
  });

  it('member satisfies member (same tier)', () => {
    expect(satisfiesRelation('member', 'member')).toBe(true);
  });

  it('member does NOT satisfy admin (lower tier fails)', () => {
    expect(satisfiesRelation('member', 'admin')).toBe(false);
  });
});

describe('satisfiesRelation, unknown roles', () => {
  it('unknown user role returns false for member', () => {
    expect(satisfiesRelation('superuser', 'member')).toBe(false);
  });

  it('unknown user role returns false for admin', () => {
    expect(satisfiesRelation('random_role', 'admin')).toBe(false);
  });

  it('unknown required relation returns false (treated as Infinity tier)', () => {
    expect(satisfiesRelation('admin', 'super_relation_not_in_hierarchy')).toBe(false);
  });

  it('both unknown returns false', () => {
    expect(satisfiesRelation('unknown_user', 'unknown_required')).toBe(false);
  });

  it('empty string user role returns false', () => {
    expect(satisfiesRelation('', 'member')).toBe(false);
  });

  it('empty string required relation returns false', () => {
    // empty string maps to Infinity in required → false
    expect(satisfiesRelation('admin', '')).toBe(false);
  });
});

describe('relationHierarchy export', () => {
  it('encodes owner > admin', () => {
    expect(relationHierarchy['owner']).toBeGreaterThan(
      relationHierarchy['admin'] ?? 0,
    );
  });

  it('encodes admin > member', () => {
    expect(relationHierarchy['admin']).toBeGreaterThan(
      relationHierarchy['member'] ?? 0,
    );
  });

  it('member tier is a positive number (above deny floor)', () => {
    expect((relationHierarchy['member'] ?? 0)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GHSA-mvxf-pr5g-7pvx: tenant roles and per-object grants are separate domains
// ---------------------------------------------------------------------------

describe('satisfiesRelation, tenant roles never reach per-object grants', () => {
  it.each([...objectScopedRelations])(
    'no tenant role satisfies the per-object relation "%s"',
    (relation) => {
      for (const role of ['owner', 'admin', 'writer', 'member', 'platform_operator']) {
        expect(
          satisfiesRelation(role, relation),
          `role "${role}" must not satisfy per-object relation "${relation}"`,
        ).toBe(false);
      }
    },
  );

  it('the per-object relation set is non-empty (guards a vacuous matrix)', () => {
    expect(objectScopedRelations.size).toBeGreaterThan(0);
  });

  it('per-object relations carry no tier on the tenant scale', () => {
    for (const relation of objectScopedRelations) {
      expect(relationHierarchy[relation]).toBeUndefined();
    }
  });
});

describe('scopeOfEntry, the object dimension', () => {
  it('classifies the caller own tenant as active_tenant', () => {
    expect(scopeOfEntry(OWN_TENANT_ADMIN_ENTRY)).toBe('active_tenant');
  });

  it('classifies the fixed platform tenant as system_tenant', () => {
    expect(
      scopeOfEntry({
        relation: 'platform_operator',
        objectType: 'system_tenant',
        objectDeriver: 'system_tenant',
      }),
    ).toBe('system_tenant');
  });

  it('classifies a field-named secret as per_object', () => {
    expect(scopeOfEntry(SECRET_ENTRY)).toBe('per_object');
  });

  it('classifies a component as per_object even when the deriver says system_tenant', () => {
    // The registry really does emit this pair. The OBJECT is what decides.
    expect(
      scopeOfEntry({
        relation: 'can_use',
        objectType: 'component',
        objectDeriver: 'system_tenant',
      }),
    ).toBe('per_object');
  });

  it('classifies an unrecognised objectType as per_object (deny-by-default)', () => {
    expect(
      scopeOfEntry({
        relation: 'admin',
        objectType: 'workspace_invented_tomorrow',
        objectDeriver: 'tenant_from_identity',
      }),
    ).toBe('per_object');
  });

  it('classifies a tenant object named by a request field as per_object', () => {
    // objectType alone is not enough: a tenant named by the body is another
    // tenant, not the caller active one.
    expect(
      scopeOfEntry({
        relation: 'admin',
        objectType: 'tenant',
        objectDeriver: "tenant_and_field('Name')",
      }),
    ).toBe('per_object');
  });

  it('classifies an entry with no object at all as per_object', () => {
    expect(scopeOfEntry({ relation: '', objectType: '', objectDeriver: '' })).toBe(
      'per_object',
    );
  });
});

describe('decideAuthEntry, a tenant admin and an object-scoped grant', () => {
  it.each(TOP_TENANT_ROLES)(
    'DENIES %s a per-object grant on a secret the check is not given',
    (role) => {
      expect(decideAuthEntry(SECRET_ENTRY, role)).toEqual({
        allowed: false,
        reason: 'object-scoped',
      });
    },
  );

  it.each(TOP_TENANT_ROLES)(
    'ALLOWS %s on the one object they do hold a role over, their active tenant',
    (role) => {
      expect(decideAuthEntry(OWN_TENANT_ADMIN_ENTRY, role)).toEqual({ allowed: true });
    },
  );

  it('DENIES a member the tenant-scoped admin relation (tier check still runs)', () => {
    expect(decideAuthEntry(OWN_TENANT_ADMIN_ENTRY, 'member')).toEqual({
      allowed: false,
      reason: 'relation-not-met',
    });
  });

  it('ALLOWS a platform_operator the system-tenant relation', () => {
    expect(
      decideAuthEntry(
        {
          relation: 'platform_operator',
          objectType: 'system_tenant',
          objectDeriver: 'system_tenant',
        },
        'platform_operator',
      ),
    ).toEqual({ allowed: true });
  });

  it('DENIES a tenant owner the system-tenant relation', () => {
    expect(
      decideAuthEntry(
        {
          relation: 'platform_operator',
          objectType: 'system_tenant',
          objectDeriver: 'system_tenant',
        },
        'owner',
      ),
    ).toEqual({ allowed: false, reason: 'relation-not-met' });
  });
});

describe('decideAuthEntry against the real generated AuthRegistry', () => {
  const entries = Object.values(AuthRegistry);
  const perObject = entries.filter((e) => scopeOfEntry(e) === 'per_object');
  const activeTenant = entries.filter((e) => scopeOfEntry(e) === 'active_tenant');

  it('the registry actually contains object-scoped entries (guards a vacuous sweep)', () => {
    expect(perObject.length).toBeGreaterThan(0);
    expect(activeTenant.length).toBeGreaterThan(0);
  });

  it.each(TOP_TENANT_ROLES)(
    'no registry entry scoped to a specific object is allowed for %s',
    (role) => {
      const wronglyAllowed = perObject
        .filter((e) => decideAuthEntry(e, role).allowed)
        .map((e) => e.method);
      expect(wronglyAllowed).toEqual([]);
    },
  );

  it('a tenant admin is still allowed every admin/member/writer RPC on its own tenant', () => {
    const wronglyDenied = activeTenant
      .filter((e) => e.relation !== 'owner' && e.relation !== 'platform_operator')
      .filter((e) => !decideAuthEntry(e, 'admin').allowed)
      .map((e) => e.method);
    expect(wronglyDenied).toEqual([]);
  });
});

describe('rolesAreCrossTenant (#615)', () => {
  it('is true for a platform_operator', () => {
    expect(rolesAreCrossTenant(['platform_operator'])).toBe(true);
  });

  it('is false for a tenant admin', () => {
    expect(rolesAreCrossTenant(['admin'])).toBe(false);
  });

  it('is false for a tenant member', () => {
    expect(rolesAreCrossTenant(['member'])).toBe(false);
  });

  it('is false for no roles', () => {
    expect(rolesAreCrossTenant([])).toBe(false);
  });

  it('is true when any role is cross-tenant', () => {
    expect(rolesAreCrossTenant(['member', 'platform_operator'])).toBe(true);
  });
});
