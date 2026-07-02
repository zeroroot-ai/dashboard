"use server";

import { setActiveTenant } from "@/src/lib/auth/active-tenant";

/**
 * Server Action wrapping setActiveTenant for the in-app tenant switcher.
 * Returns the typed result; never throws.
 */
export async function switchActiveTenantAction(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_a_member" | "resolution_failed" }> {
  return setActiveTenant(tenantId);
}
