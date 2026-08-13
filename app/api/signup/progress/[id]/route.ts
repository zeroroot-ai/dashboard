/**
 * Signup progress polling endpoint.
 *
 * GET /api/signup/progress/:id[?slug=<tenant-slug>]
 *
 * Returns the current provisioning state for a signup attempt. The client-
 * side <ProvisioningPanel /> polls this every 1s after form submission.
 *
 * Unauthenticated by design: the `attemptId` is an opaque capability. It
 * is a UUIDv4 minted server-side at `signupAction` entry, stored only in
 * (a) the daemon progress key and (b) the browser tab that submitted the
 * form. The response body contains ONLY step names + terminal error codes
 * + user-safe messages, no PII, no Zitadel IDs, no stack traces.
 *
 * Live-readiness fallback (dashboard#967): the signup Server Action is the
 * only WRITER to the progress store, and it has already returned by the
 * time a `terminalState: "timeout"` record exists — so a stored timeout
 * could previously never flip to `ok` even when the operator finished the
 * saga seconds later. When the stored record is a terminal timeout (or the
 * key has expired) AND the caller supplies the tenant slug it got back
 * from the timed-out action, this route consults the daemon's
 * operator-reported provisioning status directly and synthesizes the `ok`
 * record the action would have written, letting the panel auto-advance to
 * the /login redirect exactly like the happy path.
 *
 * The fallback discloses nothing new: `GET /api/signup/status?tenant=` is
 * an existing public, rate-limited proxy for the same per-slug readiness
 * signal. The same rate limit is applied to the fallback branch here, and
 * the branch never writes — the synthesized record exists only in the
 * response.
 */
import { NextRequest, NextResponse } from "next/server";
import { getProgress } from "@/src/lib/signup/progress-store";
import { getTenantProvisioningStatus } from "@/src/lib/gibson-client/provisioning";
import { checkRateLimit } from "@/src/lib/rate-limiter";
import type { ProvisioningProgress } from "@/app/(public)/signup/types";

export const runtime = "nodejs";
// Disable caching, the whole point is real-time polling.
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Output shape of signupAction's slugify(): lowercase DNS-label, <= 63
// chars, no leading/trailing hyphen. Anything else never names a tenant
// this flow created, so reject without touching the daemon.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Same budget as the sibling /api/signup/status probe: the panel's
// fallback poll runs every ~3s (20/min), so 60/min leaves headroom
// without letting an unauthenticated caller turn this into a high-rate
// readiness scanner.
const FALLBACK_RATE_LIMIT = {
  maxRequests: 60,
  windowSeconds: 60,
  algorithm: "fixed_window" as const,
  message: "Too many status requests. Please slow down.",
};

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Probe the operator-reported provisioning status for `slug` and, when the
 * workspace is ready, return the `ok` record the signup action would have
 * written had it still been running. Returns null when not (yet) ready or
 * when the probe fails — callers fall back to the stored record.
 *
 * Readiness predicate mirrors `waitForTenantReady` in app/actions/signup.ts:
 * `zitadelOrgReady || phase === "Ready"`.
 */
async function probeLiveReadiness(
  slug: string,
): Promise<ProvisioningProgress | null> {
  try {
    const status = await getTenantProvisioningStatus(slug);
    if (status.found && (status.zitadelOrgReady || status.phase === "Ready")) {
      return {
        step: "done",
        stepStartedAt: Date.now(),
        terminalState: "ok",
      };
    }
  } catch {
    // Daemon momentarily unreachable — the stored record (or 404) is the
    // honest answer; the panel keeps polling.
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;

  // Defensive: reject malformed ids without touching the store, so the
  // endpoint is safe to expose publicly with zero rate limiting on the
  // pure-read path.
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "invalid_id" },
      { status: 400, headers: NO_STORE },
    );
  }

  const progress = await getProgress(id);

  // Live-readiness fallback (dashboard#967): only when the stored record
  // is a dead-end — terminal timeout, or expired out of the store — and
  // the caller knows the slug. Every other state is served verbatim from
  // the store, exactly as before.
  const rawSlug = req.nextUrl.searchParams.get("slug");
  const deadEnd = progress === null || progress.terminalState === "timeout";
  if (deadEnd && rawSlug !== null && SLUG_RE.test(rawSlug)) {
    const rateLimit = await checkRateLimit(
      req,
      "signup:progress-fallback",
      FALLBACK_RATE_LIMIT,
    );
    if (rateLimit.allowed) {
      const live = await probeLiveReadiness(rawSlug);
      if (live) {
        return NextResponse.json(live, { status: 200, headers: NO_STORE });
      }
    }
    // Rate-limited or not ready: fall through to the stored answer so the
    // panel's holding state stays accurate.
  }

  if (!progress) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: NO_STORE },
    );
  }

  return NextResponse.json(progress, { status: 200, headers: NO_STORE });
}
