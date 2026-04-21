/**
 * Signup progress polling endpoint.
 *
 * GET /api/signup/progress/:id
 *
 * Returns the current provisioning state for a signup attempt. The client-
 * side <ProvisioningPanel /> polls this every 1s after form submission.
 *
 * Unauthenticated by design: the `attemptId` is an opaque capability. It
 * is a UUIDv4 minted server-side at `signupAction` entry, stored only in
 * (a) the Redis progress key and (b) the browser tab that submitted the
 * form. The response body contains ONLY step names + terminal error codes
 * + user-safe messages — no PII, no Zitadel IDs, no stack traces.
 */
import { NextResponse } from "next/server";
import { getProgress } from "@/src/lib/signup/progress-store";

export const runtime = "nodejs";
// Disable caching — the whole point is real-time polling.
export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: Request,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { id } = await params;

  // Defensive: reject malformed ids without touching Redis, so the
  // endpoint is safe to expose publicly with zero rate limiting.
  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "invalid_id" },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const progress = await getProgress(id);
  if (!progress) {
    return NextResponse.json(
      { error: "not_found" },
      {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(progress, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
