"use server";

import { redirect } from "next/navigation";

import { setActiveTenant } from "@/src/lib/auth/active-tenant";
import { validateRedirectTo } from "@/src/lib/auth/redirect-allowlist";

/**
 * Server Action invoked by the tenant picker. Validates membership
 * server-side via setActiveTenant; on success redirects to `returnTo`
 * (or /dashboard if absent / not allowlisted). On failure redirects to
 * the deterministic /login/error page with a machine-readable reason
 * code that maps to copy via the LoginErrorReason union.
 *
 * Returns `Promise<void>` so the type matches `<form action>`'s prop
 * shape in Next.js 16+. Earlier drafts returned `{ ok: false, reason }`
 * for inline rendering, but that contract is incompatible with the
 * form-action prop and the page never rendered the error UI anyway —
 * the error page is the canonical surface for these failures (per
 * spec auth-resolution-hardening R2).
 */
export async function pickTenantAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get("tenant_id") ?? "");
  const returnTo = String(formData.get("return_to") ?? "");
  if (!tenantId) {
    redirect("/login/error?reason=invalid_input");
  }
  const result = await setActiveTenant(tenantId);
  if (!result.ok) {
    redirect(`/login/error?reason=${result.reason}`);
  }
  const safeReturnTo = validateRedirectTo(returnTo);
  redirect(safeReturnTo === "/" ? "/dashboard" : safeReturnTo);
}
