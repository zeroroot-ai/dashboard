// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * GET /api/auth/session-tenant
 *
 * Re-resolves the session's tenant server-side (ADR-0093 decision 4) after a
 * tenant finishes provisioning post-sign-in. `middleware.ts` redirects a
 * signed-in person with no `session.tenantId` here once `getMyMemberships()`
 * reports exactly one membership; the onboarding page also links here once
 * its own polling sees the tenant reach Ready.
 *
 * `unstable_update({})` re-runs the `jwt` callback with `trigger: "update"`,
 * which calls `stampSessionTenant` against the SAME stored access token —
 * this route never reads a tenant from the request, there is nothing here
 * for a client to spoof.
 *
 * `return_to` is validated by `validateRedirectTo` (the same open-redirect
 * guard `pickTenantAction` used before the picker was deleted), so an
 * off-site value degrades to `/`.
 */
import { NextResponse, type NextRequest } from "next/server";

import { auth, unstable_update } from "@/auth";
import { validateRedirectTo } from "@/src/lib/auth/redirect-allowlist";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  // Re-resolve server-side. The empty object is deliberate: unstable_update
  // takes a client-supplied `session` payload for other Auth.js use cases,
  // but the `jwt` callback's `trigger === "update"` branch never reads it
  // for the tenant — only the stored access token is consulted.
  await unstable_update({});

  const returnTo = validateRedirectTo(req.nextUrl.searchParams.get("return_to"));
  return NextResponse.redirect(new URL(returnTo, req.nextUrl.origin));
}
