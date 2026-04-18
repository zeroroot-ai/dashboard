/**
 * POST /api/auth/device/approve
 *
 * Internal endpoint the /dashboard/device page hits after the user
 * clicks Approve. Binds the Device Authorization Grant to the caller's
 * existing Better Auth session so gibson-mcp's next /token poll succeeds.
 *
 * Not a public OAuth endpoint — the request MUST carry the user's
 * Better Auth session cookie.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 44.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/actions/auth/session";
import { approveFlow } from "@/src/lib/device-auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { user_code?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!body.user_code) {
    return NextResponse.json({ error: "user_code required" }, { status: 400 });
  }

  // Use the Better Auth session token string as the bearer the CLI will
  // present to the daemon. The daemon's Path 5 validator accepts it.
  const token = (session as unknown as { token?: string }).token ?? "";
  const tenantId =
    (session as unknown as { session?: { activeOrganizationId?: string } })
      .session?.activeOrganizationId ?? "";
  const ok = approveFlow(body.user_code.toUpperCase(), token, session.user.id, tenantId);
  if (!ok) {
    return NextResponse.json(
      { error: "unknown or expired code" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
