'use server';

/**
 * switchTenantAction — Server Action for tenant switching.
 *
 * Flow (once a Zitadel service-account PAT is available post-deploy):
 *
 * 1. Validate the requested slug is in the user's `gibson:tenants` claim.
 * 2. Call Zitadel Management API to set the user's "active org" metadata field
 *    to the chosen org ID.  This requires a service-account PAT with the
 *    `user.metadata.write` role on the Zitadel project.
 * 3. Trigger a `grant_type=refresh_token` token exchange against
 *    `${ZITADEL_ISSUER}/oauth/v2/token` using the refresh token from the
 *    current Auth.js session.
 * 4. The Zitadel custom claim Action (task 2) runs server-side during the
 *    token exchange, reads the new active-org metadata, and injects the updated
 *    `gibson:tenant` claim into the new access token.
 * 5. Persist the new access_token + refresh_token into the Auth.js JWT via
 *    `update()` so subsequent server renders forward the correct Bearer token
 *    to the Gibson daemon.
 *
 * TODO(post-deploy): implement the metadata-update + refresh flow.
 * Prerequisites:
 *   - ZITADEL_SA_PAT env var: Zitadel service-account PAT with
 *     IAM role `ORG_OWNER` or a custom role granting
 *     `user.metadata.write` on the Gibson project.
 *   - The Zitadel custom claim Action from task 2 must be live and associated
 *     with the token-exchange trigger.
 *
 * Until the PAT is available the action returns an instructive error so the
 * picker UI can surface it as a toast rather than crashing.
 */

import { auth } from '@/auth';
import type { Session } from 'next-auth';

export type SwitchTenantResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server Action: switch the active tenant in the OIDC token.
 *
 * @param slug  The tenant slug to switch to (must appear in the session's
 *              `tenants` list).
 */
export async function switchTenantAction(
  slug: string,
): Promise<SwitchTenantResult> {
  // -------------------------------------------------------------------------
  // 1. Resolve current session — deny unauthenticated callers.
  // -------------------------------------------------------------------------
  const session: Session | null = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Not authenticated' };
  }

  // -------------------------------------------------------------------------
  // 2. Validate the requested tenant is available to this user.
  //
  //    `gibson:tenants` is a multi-value claim injected by the Zitadel Action;
  //    it lists every org slug the user is a member of.  Until the token
  //    carries that claim we fall through to the TODO stub below.
  // -------------------------------------------------------------------------
  const availableTenants: string[] =
    (session.user as unknown as { tenants?: string[] }).tenants ?? [];

  if (availableTenants.length > 0 && !availableTenants.includes(slug)) {
    return { ok: false, error: `Tenant "${slug}" is not in your account` };
  }

  // -------------------------------------------------------------------------
  // 3. TODO(post-deploy): set Zitadel user metadata + trigger token refresh.
  //
  //    Replace this block when ZITADEL_SA_PAT is available:
  //
  //    const patAvailable = !!process.env.ZITADEL_SA_PAT;
  //    if (!patAvailable) { ... }
  //
  //    a) PUT  ${ZITADEL_ISSUER}/management/v1/users/${userId}/metadata/active_org
  //       Authorization: Bearer ${process.env.ZITADEL_SA_PAT}
  //       Body: { value: btoa(slug) }  (Zitadel metadata values are base64)
  //
  //    b) POST ${ZITADEL_ISSUER}/oauth/v2/token
  //       grant_type=refresh_token
  //       refresh_token=<session.refreshToken>
  //       client_id=${ZITADEL_CLIENT_ID}
  //       → the Zitadel Action runs here and injects the new `gibson:tenant`
  //
  //    c) Call Auth.js `unstable_update({ tokens: { ... } })` (or directly
  //       encode a new JWT cookie) to replace access + refresh tokens.
  //
  // -------------------------------------------------------------------------

  // Stub: no PAT configured — return a clear error the picker can display.
  const _ignored = slug; // lint-safe reference; slug is validated above
  return {
    ok: false,
    error:
      'Tenant switching requires a Zitadel service-account PAT ' +
      '(ZITADEL_SA_PAT). Contact your platform administrator.',
  };
}
