/**
 * FGA relation hierarchy for tenant-scoped role comparisons.
 *
 * Encodes the privilege tier ordering used by the authz registry:
 *   owner > admin > member
 *   platform_operator > admin (cross-tenant ops)
 *
 * Every authz check in the dashboard (`useAuthorize`, `assertAuthorized`)
 * routes through `satisfiesRelation`. Extend `RELATION_ORDER` here when new
 * relations are added to the proto annotations.
 *
 * Spec: dashboard-authz-ui-gating Requirement 4.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 3.1 (end state b) — table
 * accepts proto-emitted names directly so no translation sites are needed.
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
 *   1. Annotate the RPC in the SDK proto with the new relation string
 *      (e.g. `relation: "admin"`).
 *   2. Add the relation here with the appropriate tier value.
 *   3. Run `pnpm gen:authz` to regenerate the registry.
 */
const RELATION_ORDER: Readonly<Record<string, number>> = {
  // Proto-emitted relation names (canonical — these match what the SDK/daemon
  // proto annotations emit verbatim).
  owner: 150,  // tenant owner — highest tenant-scoped role; FGA: admin = [user] or owner
  admin: 100,
  member: 10,
  platform_operator: 1000, // cross-tenant ops tier — higher than any tenant-scoped relation

  // writer: tenant-scoped write access (e.g. DaemonService/CreateMissionDefinition).
  writer: 20,

  // Component / plugin / secret-scoped access grants (objectType = component|plugin|secret).
  // These are orthogonal to tenant roles; tier values establish same-domain ordering only.
  can_execute: 50,   // execute agent / LLM operations on a component
  can_configure: 75, // configure a component (implies can_execute)
  can_use: 50,       // use a component (harness / callback operations)
  can_invoke: 50,    // invoke a plugin binary
  can_resolve: 50,   // resolve a secret credential
};

/**
 * Return true when `userRole` satisfies `requiredRelation` per the hierarchy.
 *
 * Examples:
 *   satisfiesRelation('admin', 'member')   → true   (admin implies member)
 *   satisfiesRelation('member', 'admin')   → false  (member does not imply admin)
 *   satisfiesRelation('unknown', 'member') → false  (unknown = tier 0)
 *   satisfiesRelation('member', 'unknown') → false  (unknown required = Infinity)
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

/**
 * Roles that operate ACROSS tenant boundaries (not scoped to a single tenant).
 * Holding one of these is what authorizes tenant-lifecycle operations like
 * provisioning a new tenant, which no per-tenant relation can grant.
 */
export const CROSS_TENANT_ROLES: ReadonlySet<string> = new Set(["platform_operator"]);

/**
 * Report whether any of the supplied roles is a cross-tenant role.
 *
 * This replaces the removed daemon-schema lookup (`GetAuthSchema` →
 * `resolveCrossTenant`), which always returned false and silently broke
 * platform-operator provisioning. Cross-tenant status is derived directly from
 * the role here.
 */
export function rolesAreCrossTenant(roles: readonly string[]): boolean {
  return roles.some((r) => CROSS_TENANT_ROLES.has(r));
}
