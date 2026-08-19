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
 * The lookup goes through the daemon's TenantProvisioningService (via
 * `getTenantProvisioningStatus`) rather than the Kubernetes API — the dashboard
 * holds zero cluster credentials (dashboard#813). `found: false` means no
 * provisioning record exists for the slug, i.e. the workspace name is
 * available. The same helper backs the signup server action's pre-create check,
 * so client and server see the same answer. The client never opens a direct
 * gRPC channel - it only fetches this Next.js route.
 *
 * Spec / issue: zeroroot-ai/dashboard#44.
 */

import { NextRequest, NextResponse } from "next/server";

import { getTenantProvisioningStatus } from "@/src/lib/gibson-client/provisioning";
import { slugify } from "@/src/lib/signup/slug";
import { logger } from "@/src/lib/logger";
import { checkRateLimit, createRateLimitResponse } from "@/src/lib/rate-limiter";

interface ResponseBody {
  slug: string;
  available: boolean | null;
  reason?: "empty" | "lookup_failed";
}

/**
 * This route is unauthenticated and answers a question about other tenants'
 * existence, so it is a workspace-name enumeration oracle by construction. It
 * cannot be closed (the signup form needs the answer), so it is bounded
 * instead: a legitimate signup issues a handful of debounced lookups, a
 * scraper issues thousands.
 *
 * Because CAPTCHA is a deliberate WONTFIX, this limit is the only thing
 * standing between the endpoint and bulk enumeration.
 */
const LOOKUP_RATE_LIMIT = {
  maxRequests: 30,
  windowSeconds: 60,
  algorithm: "sliding_window" as const,
  message: "Too many workspace name checks. Please slow down.",
};

/**
 * Every response is padded to this floor so the "taken" and "available"
 * branches are not separable by latency.
 *
 * Without it the two branches are trivially distinguishable: a hit walks the
 * daemon's provisioning-record lookup and returns, a miss short-circuits, and
 * the difference is measurable from the client. That turns a rate-limited
 * enumeration oracle into a faster, quieter one, since an attacker can read
 * the answer from timing even when the body is uninformative.
 *
 * The floor is above the daemon's typical lookup so both branches land on it.
 * It does not equalise a lookup that overruns the floor, which is why the rate
 * limit above is the primary control and this is defense in depth.
 */
const MIN_RESPONSE_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Hold the response until `MIN_RESPONSE_MS` has elapsed since `startedAt`. */
async function equalizeTiming<T>(startedAt: number, response: T): Promise<T> {
  const elapsed = Date.now() - startedAt;
  if (elapsed < MIN_RESPONSE_MS) {
    await sleep(MIN_RESPONSE_MS - elapsed);
  }
  return response;
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ResponseBody> | NextResponse> {
  const startedAt = Date.now();

  const rateLimit = await checkRateLimit(req, "auth:tenant-available", LOOKUP_RATE_LIMIT);
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit, LOOKUP_RATE_LIMIT.message);
  }

  const rawName = req.nextUrl.searchParams.get("name") ?? "";
  const slug = slugify(rawName);

  if (!slug || slug.length < 2) {
    // The form does its own client-side regex; this is a safety net for
    // requests that slip through (or pre-slugified input that ends up
    // empty). Return `available: null`, the client treats null as
    // "don't show inline state" and lets the existing client-side
    // validation handle the empty case.
    //
    // Padded like every other branch: an unpadded short-circuit would itself
    // be a distinguishable timing signal.
    return equalizeTiming(
      startedAt,
      NextResponse.json({ slug, available: null, reason: "empty" as const }),
    );
  }

  try {
    const status = await getTenantProvisioningStatus(slug);
    // found: false ⇒ no provisioning record for the slug ⇒ name is available.
    return equalizeTiming(
      startedAt,
      NextResponse.json({ slug, available: !status.found }),
    );
  } catch (err) {
    // Any failure (daemon down, transient transport): degrade gracefully.
    // Return `available: null` with a structured reason, the client renders no
    // inline state, the user can still submit, and the signup server action's
    // pre-create check (plus the admission webhook) is the authoritative gate.
    logger.warn(
      { err, scope: "api.tenant-available.lookup_failed", slug },
      "tenant availability lookup failed (degrading to null)",
    );
    return equalizeTiming(
      startedAt,
      NextResponse.json({ slug, available: null, reason: "lookup_failed" as const }),
    );
  }
}
