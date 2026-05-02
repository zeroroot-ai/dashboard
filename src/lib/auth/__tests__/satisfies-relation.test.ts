/**
 * Data-driven test: every relation string in AuthRegistry must be a key in
 * RELATION_ORDER (excluding unauthenticated entries).
 *
 * This test prevents silent relation-drift: if a developer adds an RPC with
 * `relation: "tenant_viewer"` to a proto without first adding the relation to
 * RELATION_ORDER, this test fails at CI before the change can merge.
 *
 * The relation list is derived at runtime from the committed registry — do NOT
 * hard-code it. If new relations appear in the registry after regen, update
 * RELATION_ORDER and the test self-heals.
 *
 * Spec: cross-repo-cohesion-fixes Requirement 3.4.
 *
 * @module auth/__tests__/satisfies-relation
 */

import { describe, it, expect } from 'vitest';
import { AuthRegistry } from '@/src/gen/authz/registry';
import { relationHierarchy } from '../relation-hierarchy';

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

describe('AuthRegistry relation coverage in RELATION_ORDER (cross-repo-cohesion-fixes task 17)', () => {
  it('registry has at least one non-unauthenticated entry to test', () => {
    // Sanity guard: if the registry is empty or all entries are unauthenticated,
    // the loop below would vacuously pass.
    expect(relationsInRegistry.length).toBeGreaterThan(0);
  });

  it.each(relationsInRegistry)(
    'relation "%s" from registry is a key in RELATION_ORDER',
    (relation) => {
      expect(
        relationHierarchy,
        `relation "${relation}" appears in AuthRegistry but is missing from RELATION_ORDER. ` +
          `Add it to src/lib/auth/relation-hierarchy.ts with an appropriate tier value.`,
      ).toHaveProperty(relation);
    },
  );
});
