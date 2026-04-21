/**
 * createPersonalOrg — shared org-creation helper.
 *
 * Previously used Better Auth's org adapter to create a personal workspace
 * for newly signed-up users. With Auth.js v5 + Zitadel, tenant provisioning
 * is driven by the tenant-operator (Zitadel user.created webhook → operator
 * reconcile loop). This module is retained as a typed stub so the import
 * chain does not break during the migration; the implementation is a no-op
 * that always returns `created: false`.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log. When the tenant-operator webhook flow is wired, this
 * helper can be deleted entirely or repurposed as a wait-for-org-ready poll.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreatePersonalOrgResult {
  /** True when the org was newly created; false when already existed or skipped. */
  created: boolean;
  /** The slug of the org (new or pre-existing). */
  slug: string;
  /** The org ID (new or pre-existing). */
  orgId: string;
}

/**
 * No-op stub — tenant provisioning is now handled by the tenant-operator.
 */
export async function createPersonalOrg(
  userId: string,
  _displayName: string,
): Promise<CreatePersonalOrgResult> {
  // Operator-driven provisioning — nothing to do here.
  return { created: false, slug: userId.slice(0, 20), orgId: "" };
}
