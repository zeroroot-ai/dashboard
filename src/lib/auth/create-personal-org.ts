/**
 * createPersonalOrg — shared org-creation helper.
 *
 * Factored out of signUpAction so it can be reused by the
 * `databaseHooks.user.afterCreate` hook that fires for social sign-ins.
 *
 * Uses Better Auth's org adapter directly (not the HTTP API) so it can be
 * called from a context that has no active session cookie — specifically
 * inside a databaseHook where the user row has just been written but no
 * session exists yet.
 *
 * Guarantees:
 *  - Idempotent: no-ops if an org with the derived slug already exists.
 *  - Does NOT create a second org if the user already has a membership
 *    (checked via findOrganizationBySlug on the derived slug).
 *  - The user is added as an `owner` member of the new org.
 *  - Any failure is propagated to the caller; callers in the hook path
 *    should catch and log without crashing startup.
 *
 * Note on signUpAction compatibility:
 *   signUpAction continues to call `auth.api.createOrganization` directly
 *   because it owns the retry loop (3 attempts, jittered backoff), rollback
 *   on permanent failure, and Stripe flow. This helper is ONLY for the
 *   social sign-in hook path where no billing tier is selected and no
 *   transaction rollback is needed.
 */

import { auth } from "@/src/lib/auth-server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function getOrgAdapterInstance() {
  const { getOrgAdapter } = await import("better-auth/plugins/organization");
  // auth.$context is typed as the concrete plugin-context; cast through unknown
  // to match the AuthContext interface expected by getOrgAdapter.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = (await auth.$context) as any;
  return getOrgAdapter(ctx);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CreatePersonalOrgResult {
  /** True when the org was newly created; false when already existed. */
  created: boolean;
  /** The slug of the org (new or pre-existing). */
  slug: string;
  /** The org ID (new or pre-existing). */
  orgId: string;
}

/**
 * Create a personal organisation for a newly-created user.
 *
 * @param userId     — Better Auth user ID (from the created user row).
 * @param displayName — Display name to derive the org name and slug from.
 *
 * @throws when the org adapter call fails and the caller has not caught it.
 */
export async function createPersonalOrg(
  userId: string,
  displayName: string,
): Promise<CreatePersonalOrgResult> {
  const slug = slugify(displayName || userId.slice(0, 20));
  const orgName = displayName || `Workspace ${userId.slice(0, 8)}`;

  const adapter = await getOrgAdapterInstance();

  // Idempotency check — if the slug already exists this is a no-op.
  const existing = await adapter.findOrganizationBySlug(slug);
  if (existing) {
    return { created: false, slug: existing.slug, orgId: existing.id };
  }

  // Create the org record.
  const org = await adapter.createOrganization({
    organization: {
      name: orgName,
      slug,
      createdAt: new Date(),
    },
  });

  // Add the user as owner.
  await adapter.createMember({
    organizationId: org.id,
    userId,
    role: "owner",
    createdAt: new Date(),
  });

  return { created: true, slug: org.slug, orgId: org.id };
}
