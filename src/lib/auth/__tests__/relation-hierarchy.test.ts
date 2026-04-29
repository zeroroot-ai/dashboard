/**
 * Unit tests for src/lib/auth/relation-hierarchy.ts
 *
 * Covers the full satisfiesRelation matrix:
 *   - tenant_admin satisfies tenant_admin (same tier)
 *   - tenant_admin satisfies tenant_member (higher tier satisfies lower)
 *   - tenant_member satisfies tenant_member (same tier)
 *   - tenant_member does NOT satisfy tenant_admin (lower tier fails higher)
 *   - unknown user role returns false (tier 0 < any known tier)
 *   - unknown required relation returns false (Infinity required)
 *   - both unknown returns false
 *
 * Spec: dashboard-authz-ui-gating Requirement 4.
 */

import { describe, it, expect } from 'vitest';
import { satisfiesRelation, relationHierarchy } from '../relation-hierarchy';

describe('satisfiesRelation — hierarchy ordering', () => {
  it('tenant_admin satisfies tenant_admin (same tier)', () => {
    expect(satisfiesRelation('tenant_admin', 'tenant_admin')).toBe(true);
  });

  it('tenant_admin satisfies tenant_member (higher tier implies lower)', () => {
    expect(satisfiesRelation('tenant_admin', 'tenant_member')).toBe(true);
  });

  it('tenant_member satisfies tenant_member (same tier)', () => {
    expect(satisfiesRelation('tenant_member', 'tenant_member')).toBe(true);
  });

  it('tenant_member does NOT satisfy tenant_admin (lower tier fails)', () => {
    expect(satisfiesRelation('tenant_member', 'tenant_admin')).toBe(false);
  });
});

describe('satisfiesRelation — unknown roles', () => {
  it('unknown user role returns false for tenant_member', () => {
    expect(satisfiesRelation('superuser', 'tenant_member')).toBe(false);
  });

  it('unknown user role returns false for tenant_admin', () => {
    expect(satisfiesRelation('random_role', 'tenant_admin')).toBe(false);
  });

  it('unknown required relation returns false (treated as Infinity tier)', () => {
    expect(satisfiesRelation('tenant_admin', 'super_relation_not_in_hierarchy')).toBe(false);
  });

  it('both unknown returns false', () => {
    expect(satisfiesRelation('unknown_user', 'unknown_required')).toBe(false);
  });

  it('empty string user role returns false', () => {
    expect(satisfiesRelation('', 'tenant_member')).toBe(false);
  });

  it('empty string required relation returns false', () => {
    // empty string maps to Infinity in required → false
    expect(satisfiesRelation('tenant_admin', '')).toBe(false);
  });
});

describe('relationHierarchy export', () => {
  it('encodes tenant_admin > tenant_member', () => {
    expect(relationHierarchy['tenant_admin']).toBeGreaterThan(
      relationHierarchy['tenant_member'] ?? 0,
    );
  });

  it('tenant_member tier is a positive number (above deny floor)', () => {
    expect((relationHierarchy['tenant_member'] ?? 0)).toBeGreaterThan(0);
  });
});
