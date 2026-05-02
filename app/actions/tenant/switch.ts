'use server';

/**
 * switchTenantAction — Server Action for tenant switching.
 *
 * Two distinct flows live in this codebase:
 *
 * 1. **Active-tenant cookie switch.** The in-app sidebar / header
 *    `TenantSwitcher` calls `switchActiveTenantAction` (in
 *    `components/gibson/shared/tenant-switcher-action.ts`), which writes
 *    the HMAC-signed `gibson_active_tenant` cookie via `setActiveTenant`
 *    after validating membership against FGA. That is the path users
 *    actually exercise today; it does not need a Zitadel token refresh
 *    because the dashboard's tenant resolution reads the cookie + FGA on
 *    every request rather than the OIDC token.
 *
 * 2. **OIDC active-org metadata switch (this action).** Reserved for the
 *    future case where the *issued* token must reflect the active tenant
 *    (e.g. for a downstream consumer that does not run through ext-authz).
 *    Requires a Zitadel service-account PAT to update user metadata, then
 *    a refresh-token exchange to mint a new access token. Not implemented
 *    until ZITADEL_SA_PAT is available.
 *
 * The validation below uses `getServerSession()` (the FGA-enriched
 * session) so an invalid slug is rejected immediately even before the
 * PAT path is wired up. Previously this read raw `auth().session.user`
 * tenant fields that the Auth.js session callback never sets — the
 * validation was decorative.
 */

import { getServerSession } from '@/src/lib/auth';

export type SwitchTenantResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Server Action: switch the OIDC active-org metadata for a tenant.
 *
 * @param slug  The tenant slug to switch to (must appear in the user's
 *              FGA membership list).
 */
export async function switchTenantAction(
  slug: string,
): Promise<SwitchTenantResult> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: 'Not authenticated' };
  }

  const availableTenants: string[] = session.user.tenants ?? [];

  // Membership-resolution failure (empty list with non-null user) is
  // surfaced as a structured error rather than silently allowing the
  // switch — the caller shows it as a toast.
  if (availableTenants.length === 0) {
    return {
      ok: false,
      error:
        'Could not resolve your workspace memberships. Try again or sign out and back in.',
    };
  }

  if (!availableTenants.includes(slug)) {
    return { ok: false, error: `Tenant "${slug}" is not in your account` };
  }

  // -------------------------------------------------------------------------
  // TODO(post-deploy): set Zitadel user metadata + trigger token refresh.
  //
  //    Replace this block when ZITADEL_SA_PAT is available:
  //
  //    a) PUT  ${ZITADEL_ISSUER}/management/v1/users/${userId}/metadata/active_org
  //       Authorization: Bearer ${process.env.ZITADEL_SA_PAT}
  //       Body: { value: btoa(slug) }  (Zitadel metadata values are base64)
  //
  //    b) POST ${ZITADEL_ISSUER}/oauth/v2/token
  //       grant_type=refresh_token
  //       refresh_token=<session.refreshToken>
  //       client_id=${ZITADEL_CLIENT_ID}
  //       → the Zitadel Action runs here and injects the new active org
  //
  //    c) Replace access + refresh tokens via Auth.js update().
  //
  //    For the in-app cookie-only switch path, callers should use
  //    `switchActiveTenantAction` from
  //    `@/components/gibson/shared/tenant-switcher-action` instead — that
  //    path is fully implemented today and writes the HMAC-signed
  //    active-tenant cookie.
  // -------------------------------------------------------------------------

  return {
    ok: false,
    error:
      'Tenant switching via OIDC token refresh requires a Zitadel ' +
      'service-account PAT (ZITADEL_SA_PAT). Use the in-app workspace ' +
      'switcher for cookie-based switches.',
  };
}
