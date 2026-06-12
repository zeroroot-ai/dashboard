/**
 * GET /api/auth/tenant-available?name=<input>
 *
 * Returns `{ slug, available }` for the slugified form of `name`. The
 * signup form calls this on a debounced cadence (~400ms) while the user
 * types, so the "That workspace name is already taken" failure surfaces
 * inline before the form is submitted.
 *
 * Public route, no user auth required. The signup form runs pre-session.
 * The endpoint mirrors the existing `safeGetTenant(slug)` check in
 * `app/actions/signup.ts` so the inline check returns the same answer the
 * server action would on submit; that server-side check is preserved as
 * defense-in-depth against TOCTOU races between two simultaneous signups.
 *
 * The lookup uses the K8s API (via `getTenant`) rather than a daemon
 * RPC because the existing `safeGetTenant` check in the signup server
 * action does the same, and re-using that path guarantees client+server
 * see the same answer. The client never opens a direct gRPC channel -
 * it only fetches this Next.js route.
 *
 * Spec / issue: zeroroot-ai/dashboard#44.
 */

import { NextRequest, NextResponse } from "next/server";

import { getTenant } from "@/src/lib/k8s/tenants";
import { K8sNotFoundError } from "@/src/lib/k8s/errors";
import { slugify } from "@/src/lib/signup/slug";
import { logger } from "@/src/lib/logger";

interface ResponseBody {
  slug: string;
  available: boolean | null;
  reason?: "empty" | "lookup_failed";
}

export async function GET(req: NextRequest): Promise<NextResponse<ResponseBody>> {
  const rawName = req.nextUrl.searchParams.get("name") ?? "";
  const slug = slugify(rawName);

  if (!slug || slug.length < 2) {
    // The form does its own client-side regex; this is a safety net for
    // requests that slip through (or pre-slugified input that ends up
    // empty). Return `available: null`, the client treats null as
    // "don't show inline state" and lets the existing client-side
    // validation handle the empty case.
    return NextResponse.json({ slug, available: null, reason: "empty" });
  }

  try {
    await getTenant(slug);
    // getTenant resolved without throwing → tenant with that slug exists.
    return NextResponse.json({ slug, available: false });
  } catch (err) {
    if (err instanceof K8sNotFoundError) {
      return NextResponse.json({ slug, available: true });
    }

    // Any other failure (K8s API down, RBAC, transient transport): degrade
    // gracefully. Return `available: null` with a structured reason, the
    // client renders no inline state, the user can still submit, and the
    // signup server action's pre-create check (plus the admission webhook)
    // is the authoritative gate.
    logger.warn(
      { err, scope: "api.tenant-available.lookup_failed", slug },
      "tenant availability lookup failed (degrading to null)",
    );
    return NextResponse.json({ slug, available: null, reason: "lookup_failed" });
  }
}
