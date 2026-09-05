/**
 * Data-driven test: every relation string in AuthRegistry must be classified
 * into EXACTLY ONE domain, the tenant-role scale (`relationHierarchy`) or the
 * per-object grant set (`objectScopedRelations`).
 *
 * This test prevents silent relation-drift: if a developer adds an RPC with
 * `relation: "tenant_viewer"` to a proto without first classifying it, this
 * test fails at CI before the change can merge.
 *
 * "Exactly one" is the load-bearing part. A relation in BOTH tables would be
 * a per-object grant that a tenant role can also reach, which is the shape of
 * GHSA-mvxf-pr5g-7pvx: `can_resolve` used to sit on the tenant scale below
 * `admin`, so every tenant admin satisfied it on every secret.
 *
 * The relation list is derived at runtime from the committed registry, do NOT
 * hard-code it. If new relations appear in the registry after regen, classify
 * them in relation-hierarchy.ts and the test self-heals.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 3.4.
 *
 * @module auth/__tests__/satisfies-relation
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';
import { relationHierarchy, objectScopedRelations } from '../relation-hierarchy';

// Collect the unique set of non-empty relation strings from registry entries
// that are NOT unauthenticated. Unauthenticated entries have an empty relation
// (no FGA check runs for them) and are intentionally excluded.
const relationsInRegistry = [
  ...new Set(
    Object.values(AuthRegistry)
      .filter((entry) => !entry.unauthenticated && entry.relation !== '')
      .map((entry) => entry.relation),
  ),
].sort();

describe('AuthRegistry relation classification (cross-repo-cohesion-fixes task 17)', () => {
  it('registry has at least one non-unauthenticated entry to test', () => {
    // Sanity guard: if the registry is empty or all entries are unauthenticated,
    // the loop below would vacuously pass.
    expect(relationsInRegistry.length).toBeGreaterThan(0);
  });

  it('registry contains relations from BOTH domains, so neither branch is vacuous', () => {
    expect(relationsInRegistry.some((r) => r in relationHierarchy)).toBe(true);
    expect(relationsInRegistry.some((r) => objectScopedRelations.has(r))).toBe(true);
  });

  it.each(relationsInRegistry)(
    'relation "%s" from registry is classified in exactly one domain',
    (relation) => {
      const isTenantRole = relation in relationHierarchy;
      const isObjectScoped = objectScopedRelations.has(relation);
      expect(
        [isTenantRole, isObjectScoped].filter(Boolean).length,
        `relation "${relation}" appears in AuthRegistry but is not classified in exactly ` +
          `one domain (tenant role: ${isTenantRole}, object-scoped: ${isObjectScoped}). ` +
          `Classify it in src/lib/auth/relation-hierarchy.ts: a role held on a tenant goes ` +
          `in TENANT_ROLE_ORDER with a tier, a grant held on one component/plugin/secret ` +
          `goes in OBJECT_SCOPED_RELATIONS with no tier. A relation in both would let a ` +
          `tenant role satisfy a per-object grant.`,
      ).toBe(1);
    },
  );

  it('no tenant role is also an object-scoped relation', () => {
    const overlap = Object.keys(relationHierarchy).filter((r) =>
      objectScopedRelations.has(r),
    );
    expect(overlap).toEqual([]);
  });
});
