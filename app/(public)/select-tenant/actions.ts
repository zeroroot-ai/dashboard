"use server";

import { redirect } from "next/navigation";

import { setActiveTenant } from "@/src/lib/auth/active-tenant";
import { validateRedirectTo } from "@/src/lib/auth/redirect-allowlist";

/**
 * Server Action invoked by the tenant picker. Validates membership
 * server-side via setActiveTenant; on success redirects to `returnTo`
 * (or /dashboard if absent / not allowlisted). On failure surfaces an
 * inline error code the page maps to copy.
 */
export async function pickTenantAction(
  formData: FormData,
): Promise<{ ok: false; reason: "not_a_member" | "resolution_failed" | "invalid_input" } | never> {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "");
  if (!tenantId) {
    return { ok: false, reason: "invalid_input" };
  }
  const result = await setActiveTenant(tenantId);
  if (!result.ok) {
    return result;
  }
  const safeReturnTo = validateRedirectTo(returnTo);
  redirect(safeReturnTo === "/" ? "/dashboard" : safeReturnTo);
}
