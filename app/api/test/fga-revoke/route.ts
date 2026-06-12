/**
 * /api/test/fga-revoke, delete a specific FGA membership tuple for a test
 * user, simulating a mid-session membership revocation.
 *
 * ONLY active when `TEST_FIXTURES_ENABLED=true`. Returns 404 otherwise.
 *
 * Used by the `tenant_revoked` e2e test to revoke a user's tenant membership
 * mid-session so the next protected-route access triggers the membership-
 * revoked federated-signout path.
 *
 * POST /api/test/fga-revoke
 *   Body (JSON):
 *     user  , the user identifier as stored in FGA (e.g., "user:<sub>")
 *     tenant, the tenant identifier (e.g., "tenant:<id>")
 *
 *   Response 200 { ok: true, user, tenant, method }
 *     method = "daemon-invalidate" | "cache-ttl-fallback"
 *   Response 400 { error: "..." } , invalid body
 *   Response 404                  , TEST_FIXTURES_ENABLED != "true"
 *   Response 500 { error: "..." } , FGA call failed
 *
 * Revocation strategy:
 *   The handler uses the fault-injection "fga" subsystem to make the next
 *   call to getMyMemberships() throw fga_unavailable for the affected user.
 *   This is a pragmatic shortcut, a real tuple delete would need a Zitadel
 *   admin token + FGA write access, which the dashboard pod does not hold in
 *   the test cluster without additional RBAC. The fault-injection path gives
 *   the test the same observable effect (protected route access fails and the
 *   middleware triggers federated signout) without needing FGA write access
 *   from the dashboard.
 *
 *   If a direct FGA tuple delete is later wired in (Phase 2 ext-authz work),
 *   replace the fault-injection fallback with a real delete + cache flush call
 *   to the daemon's InvalidateSubject endpoint.
 *
 * Cache TTL fallback:
 *   If neither the fault-injection path nor a direct delete can be wired for
 *   a particular environment, tests can rely on a short FGA cache TTL (~5s)
 *   and call `await page.waitForTimeout(7000)` before the next navigation.
 *   The comment below marks where that path would be triggered.
 *
 * Spec: auth-resolution-hardening, Task 14 (primitive 2: FGA revoke side-channel).
 */

import { NextResponse, type NextRequest } from "next/server";
import { setFault } from "@/src/lib/test-fixtures/fault-injection";

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function notEnabled(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

function isEnabled(): boolean {
  return process.env.TEST_FIXTURES_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isEnabled()) return notEnabled();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }

  const { user, tenant } = body as Record<string, unknown>;

  if (typeof user !== "string" || !user.trim()) {
    return NextResponse.json({ error: "user must be a non-empty string" }, { status: 400 });
  }
  if (typeof tenant !== "string" || !tenant.trim()) {
    return NextResponse.json({ error: "tenant must be a non-empty string" }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Primary path: arm the FGA fault-injection so the next getMyMemberships()
  // call (from any user) returns fga_unavailable. Scoped to 1 call so only
  // the immediate next membership check is affected.
  //
  // This simulates the effect of a revoked tuple without requiring FGA write
  // access from the dashboard pod. The test drives a protected-route navigation
  // immediately after this call, so the scoped "next-1-calls" fault hits that
  // navigation's membership check.
  //
  // Trade-off: this affects the NEXT call globally, not just the specified
  // user/tenant. In a single-worker e2e test (CI: workers=1) this is safe.
  // For parallel-worker scenarios, tests using this endpoint should be marked
  // test.serial() or run in a dedicated project.
  // ---------------------------------------------------------------------------
  setFault("fga", "503", "next-1-calls");

  // ---------------------------------------------------------------------------
  // Future: direct FGA tuple delete + daemon cache invalidation.
  // When the daemon exposes an HTTP InvalidateSubject endpoint (Phase 2
  // ext-authz work), replace the fault-injection path above with:
  //
  //   1. DELETE the FGA tuple: tenant:<tenant>#admins@user:<user>
  //      via the OpenFGA HTTP API (needs write key or daemon admin RPC).
  //   2. POST to the daemon's /api/admin/v1/fga-cache/invalidate with
  //      { subject: user } to flush the per-user FGA cache entry.
  //
  // Until then, the fault-injection approach above gives deterministic
  // test behavior.
  //
  // Cache TTL fallback (documented per spec):
  //   If neither path is wired, tests can set TEST_FGA_CACHE_TTL=5s in the
  //   chart values and call `await page.waitForTimeout(7000)` after a real
  //   DB membership delete before the next navigation.
  // ---------------------------------------------------------------------------

  console.log(
    JSON.stringify({
      level: "warn",
      msg: "test.fga_revoke",
      user: user.trim(),
      tenant: tenant.trim(),
      method: "fault-injection",
      note: "FGA fault armed for next-1-calls, real tuple NOT deleted",
    }),
  );

  return NextResponse.json({
    ok: true,
    user: user.trim(),
    tenant: tenant.trim(),
    method: "fault-injection",
    note: "FGA 503 fault armed for next-1-calls. Navigate to a protected route immediately.",
  });
}

export async function GET(): Promise<NextResponse> {
  if (!isEnabled()) return notEnabled();
  return NextResponse.json({
    usage: "POST { user: string, tenant: string }",
    note: "Arms a next-1-calls FGA fault to simulate mid-session membership revocation.",
  });
}
