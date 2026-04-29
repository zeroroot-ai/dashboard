/**
 * FGA relation hierarchy for tenant-scoped role comparisons.
 *
 * Encodes the privilege tier ordering used by the authz registry:
 *   tenant_admin > tenant_member
 *
 * Every authz check in the dashboard (`useAuthorize`, `assertAuthorized`)
 * routes through `satisfiesRelation`. Extend `RELATION_ORDER` here when new
 * relations are added to the proto annotations.
 *
 * Spec: dashboard-authz-ui-gating Requirement 4.
 *
 * @module auth/relation-hierarchy
 */

/**
 * Privilege tier for each known FGA relation.
 *
 * Higher number = more privilege. A user whose role maps to a higher tier
 * satisfies any requirement at an equal or lower tier.
 *
 * Unknown role strings receive tier 0 — default-deny for unrecognised values.
 *
 * To add a new relation:
 *   1. Annotate the RPC in the SDK proto with the new relation string.
 *   2. Add the relation here with the appropriate tier value.
 *   3. Run `pnpm gen:authz` to regenerate the registry.
 */
const RELATION_ORDER: Readonly<Record<string, number>> = {
  tenant_admin: 100,
  tenant_member: 10,
  // tenant_viewer: 1,  // uncomment if the registry uses this relation
};

/**
 * Return true when `userRole` satisfies `requiredRelation` per the hierarchy.
 *
 * Examples:
 *   satisfiesRelation('tenant_admin', 'tenant_member') → true   (admin implies member)
 *   satisfiesRelation('tenant_member', 'tenant_admin') → false  (member does not imply admin)
 *   satisfiesRelation('unknown', 'tenant_member')      → false  (unknown = tier 0)
 *   satisfiesRelation('tenant_member', 'unknown')      → false  (unknown required = Infinity)
 *
 * @param userRole         - The role held by the user on the active tenant.
 * @param requiredRelation - The relation required by the registry entry.
 */
export function satisfiesRelation(userRole: string, requiredRelation: string): boolean {
  const userTier = RELATION_ORDER[userRole] ?? 0;
  const requiredTier = RELATION_ORDER[requiredRelation] ?? Infinity;
  return userTier >= requiredTier;
}

/**
 * The full hierarchy as a readonly record, exported for introspection in tests
 * and documentation. Not intended for runtime use by authz checks — use
 * `satisfiesRelation` instead.
 */
export const relationHierarchy: Readonly<Record<string, number>> = RELATION_ORDER;
