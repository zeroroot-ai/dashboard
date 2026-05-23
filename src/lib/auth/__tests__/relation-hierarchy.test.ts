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
import { satisfiesRelation, relationHierarchy } from '../relation-hierarchy';

describe('satisfiesRelation — hierarchy ordering', () => {
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

describe('satisfiesRelation — unknown roles', () => {
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
