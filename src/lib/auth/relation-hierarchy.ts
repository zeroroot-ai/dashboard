/**
 * The dashboard's authorization decision model.
 *
 * A registry entry names TWO things: the OBJECT the FGA check runs against
 * (`objectType` + `objectDeriver`) and the RELATION the caller must hold on
 * that object (`relation`). The dashboard's check is given only one input,
 * the caller's role on the active tenant. It never sees the request body, so
 * it can only decide entries whose object IS the active tenant (or the fixed
 * system tenant). Everything else is decided by the daemon + ext-authz, which
 * do see the object.
 *
 * Two structural rules follow, and both are enforced here rather than left to
 * each call site:
 *
 *   1. Object scope comes FIRST. `decideAuthEntry` switches on the object
 *      dimension and its default branch is DENY, so an entry naming any
 *      object other than the active/system tenant is refused before a
 *      relation is even compared. A new objectType, a new deriver, or a
 *      relation nobody has classified all land in that branch automatically.
 *
 *   2. Object-scoped relations are NOT on the tenant-role scale. `admin` is a
 *      role on a tenant; `can_resolve` is a grant on one secret. They are
 *      different domains and are never comparable, so no tenant role can
 *      outrank a per-object grant.
 *
 * Before this module was object-aware, both were a single numeric scale and a
 * tenant admin (tier 100) satisfied every per-object relation (tier 50 to 75)
 * on every object. See GHSA-mvxf-pr5g-7pvx.
 *
 * Every authz check in the dashboard (`useAuthorize`, `assertAuthorized`)
 * routes through `decideAuthEntry`. `app/actions/crd/_authz.ts` authorizes
 * named CRD actions rather than registry entries and calls `satisfiesRelation`
 * directly; its relations are all tenant-scoped.
 *
 * Spec: dashboard-authz-ui-gating Requirement 4.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 3.1 (end state b), table
 * accepts proto-emitted names directly so no translation sites are needed.
 *
 * @module auth/relation-hierarchy
 */

// ---------------------------------------------------------------------------
// Domain 1: tenant-scoped roles
// ---------------------------------------------------------------------------

/**
 * Privilege tier for each TENANT-SCOPED role, the only relations a membership
 * can carry.
 *
 * Higher number = more privilege. A user whose role maps to a higher tier
 * satisfies any requirement at an equal or lower tier. Unknown role strings
 * receive tier 0, default-deny for unrecognised values.
 *
 * This scale covers tenant roles ONLY. Per-object grants live in
 * `OBJECT_SCOPED_RELATIONS` below and deliberately have no tier, so they can
 * never be reached by holding a tenant role.
 *
 * To add a new tenant role:
 *   1. Annotate the RPC in the SDK proto with the new relation string
 *      (e.g. `relation: "auditor"`).
 *   2. Add the relation here with the appropriate tier value.
 *   3. Run `pnpm gen:authz` to regenerate the registry.
 */
const TENANT_ROLE_ORDER: Readonly<Record<string, number>> = {
  // Proto-emitted relation names (canonical, these match what the SDK/daemon
  // proto annotations emit verbatim).
  platform_operator: 1000, // cross-tenant ops tier, higher than any tenant-scoped relation
  owner: 150, // tenant owner, highest tenant-scoped role; FGA: admin = [user] or owner
  admin: 100,
  // writer: tenant-scoped write access (e.g. DaemonService/CreateMissionDefinition).
  writer: 20,
  member: 10,
};

// ---------------------------------------------------------------------------
// Domain 2: per-object grants
// ---------------------------------------------------------------------------

/**
 * Relations granted on a SPECIFIC object (a component, a plugin, a secret),
 * not on a tenant.
 *
 * These have no tier on purpose. Holding one is a property of an (object,
 * subject) pair recorded in FGA, and the dashboard's membership-only check is
 * never told which object the request names. Putting them on the tenant scale
 * is what let a tenant admin satisfy `can_resolve` on every secret in the
 * tenant.
 *
 * Membership in this set is a classification, not a ranking. Nothing compares
 * two entries of this set, and nothing compares an entry of this set with a
 * tenant role.
 */
const OBJECT_SCOPED_RELATIONS: ReadonlySet<string> = new Set([
  'can_execute', // execute agent / LLM operations on a component
  'can_configure', // configure a component
  'can_use', // use a component (harness / callback operations)
  'can_invoke', // invoke a plugin binary
  'can_resolve', // resolve a secret credential
]);

/**
 * Return true when `userRole` satisfies `requiredRelation`.
 *
 * `userRole` is always a role held on a tenant (it comes from a membership).
 * A tenant role therefore NEVER satisfies a per-object relation, whatever its
 * tier: those two live in different domains and the comparison is refused.
 *
 * Examples:
 *   satisfiesRelation('admin', 'member')      → true   (admin implies member)
 *   satisfiesRelation('member', 'admin')      → false  (member does not imply admin)
 *   satisfiesRelation('admin', 'can_resolve') → false  (different domain)
 *   satisfiesRelation('unknown', 'member')    → false  (unknown = tier 0)
 *   satisfiesRelation('member', 'unknown')    → false  (unknown required = Infinity)
 *
 * @param userRole         - The role held by the user on the active tenant.
 * @param requiredRelation - The relation required by the registry entry.
 */
export function satisfiesRelation(userRole: string, requiredRelation: string): boolean {
  // A per-object grant is not on the tenant scale and is not satisfiable by
  // any tenant role. Decided by the daemon, which knows the object.
  if (OBJECT_SCOPED_RELATIONS.has(requiredRelation)) return false;

  const userTier = TENANT_ROLE_ORDER[userRole] ?? 0;
  const requiredTier = TENANT_ROLE_ORDER[requiredRelation] ?? Infinity;
  return userTier >= requiredTier;
}

// ---------------------------------------------------------------------------
// The object dimension
// ---------------------------------------------------------------------------

/**
 * Which object a registry entry's FGA check runs against, from the point of
 * view of a check that knows only the caller's active tenant.
 *
 *   - `active_tenant`, the object is the caller's own tenant, derived from
 *     their identity. The membership role is exactly the right input.
 *   - `system_tenant`, the object is the one fixed platform-wide tenant.
 *     Decided by the caller holding the cross-tenant relation.
 *   - `per_object`, the object is named by request data (or by an
 *     object/deriver pair this code does not recognize). NOT decidable here.
 */
type AuthzScope = 'active_tenant' | 'system_tenant' | 'per_object';

/** The registry fields `scopeOfEntry` reads. Structurally an `AuthEntry`. */
interface ScopedAuthEntry {
  relation: string;
  objectType: string;
  objectDeriver: string;
}

/**
 * Classify a registry entry by the object its check runs against.
 *
 * Both the objectType AND the deriver must match a known pair. Anything else
 * (a `tenant_and_field('Name')` deriver, a `component` object, an empty
 * objectType, a value added to the protos tomorrow) falls through to
 * `per_object`, which `decideAuthEntry` denies. The default branch is the
 * safe one, so a new proto annotation cannot silently become allowable.
 */
export function scopeOfEntry(entry: ScopedAuthEntry): AuthzScope {
  if (entry.objectType === 'tenant' && entry.objectDeriver === 'tenant_from_identity') {
    return 'active_tenant';
  }
  if (entry.objectType === 'system_tenant' && entry.objectDeriver === 'system_tenant') {
    return 'system_tenant';
  }
  return 'per_object';
}

/**
 * Why a registry entry was refused. Carries no role, tenant, or object data.
 *
 *   - `relation-not-met`, the object was in scope and the caller's tenant role
 *     ranks below the required relation.
 *   - `object-scoped`, the entry's check runs against an object this code is
 *     not given, so it cannot be decided here and is refused.
 */
type AuthzDenyReason = 'relation-not-met' | 'object-scoped';

/** The outcome of `decideAuthEntry`. */
type AuthzVerdict =
  | { allowed: true }
  | { allowed: false; reason: AuthzDenyReason };

/**
 * The dashboard's single authorization decision: may a caller holding
 * `activeTenantRole` on the active tenant invoke `entry`?
 *
 * Object scope is checked BEFORE the relation, so a tenant role is never even
 * compared against a per-object grant. This is the structural half of the fix
 * for GHSA-mvxf-pr5g-7pvx: `satisfiesRelation` alone answers "is this role
 * senior enough", which is the wrong question for an entry whose check runs
 * against one specific secret, component, or plugin.
 *
 * @param entry             - The registry entry for the RPC being invoked.
 * @param activeTenantRole  - The caller's role on the cookie-confirmed active
 *                            tenant.
 */
export function decideAuthEntry(
  entry: ScopedAuthEntry,
  activeTenantRole: string,
): AuthzVerdict {
  if (scopeOfEntry(entry) === 'per_object') {
    return { allowed: false, reason: 'object-scoped' };
  }
  return satisfiesRelation(activeTenantRole, entry.relation)
    ? { allowed: true }
    : { allowed: false, reason: 'relation-not-met' };
}

// ---------------------------------------------------------------------------
// Introspection surface (tests and documentation)
// ---------------------------------------------------------------------------

/**
 * The tenant-role scale as a readonly record, exported for introspection in
 * tests and documentation. Not intended for runtime use by authz checks, use
 * `decideAuthEntry` instead.
 */
export const relationHierarchy: Readonly<Record<string, number>> = TENANT_ROLE_ORDER;

/**
 * The per-object relation set, exported for introspection in tests and
 * documentation. The registry-drift test asserts every relation the generated
 * AuthRegistry contains is classified into exactly one of `relationHierarchy`
 * and this set, so a new proto relation cannot land unclassified.
 */
export const objectScopedRelations: ReadonlySet<string> = OBJECT_SCOPED_RELATIONS;

/**
 * Roles that operate ACROSS tenant boundaries (not scoped to a single tenant).
 * Holding one of these is what authorizes tenant-lifecycle operations like
 * provisioning a new tenant, which no per-tenant relation can grant.
 */
const CROSS_TENANT_ROLES: ReadonlySet<string> = new Set(['platform_operator']);

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
