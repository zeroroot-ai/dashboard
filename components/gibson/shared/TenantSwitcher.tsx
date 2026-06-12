/**
 * Tenant switcher (Server Component).
 *
 * Reads memberships + active tenant on the server (via the membership module
 * and active-tenant cookie helper) and renders a Client child that handles
 * the interactive dropdown + Server Action invocation. Hidden when the user
 * has zero or one membership, single-tenant users see no UI noise.
 */
import { getMyMemberships, MembershipResolutionError, type Membership } from "@/src/lib/auth/membership";
import { readRawActiveTenant } from "@/src/lib/auth/active-tenant";
import { TenantSwitcherClient } from "./TenantSwitcherClient";

export async function TenantSwitcher() {
  let memberships: Membership[];
  try {
    memberships = await getMyMemberships();
  } catch (err) {
    // Don't crash the chrome on a transient FGA blip, render nothing and
    // let the user retry on next render. Middleware will route to
    // /login/error if the failure persists across requests.
    if (err instanceof MembershipResolutionError) {
      return null;
    }
    throw err;
  }

  if (memberships.length <= 1) {
    return null;
  }

  const raw = await readRawActiveTenant();
  const activeTenantId = raw.status === "present" ? raw.tenantId : undefined;

  return (
    <TenantSwitcherClient
      memberships={memberships}
      activeTenantId={activeTenantId}
    />
  );
}
