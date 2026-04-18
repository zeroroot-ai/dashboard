/**
 * POST /api/auth/device/token
 *
 * Device Authorization Grant, step 2. gibson-mcp polls here with the
 * device_code it received from /authorize. We return:
 *
 *   * 202 (authorization_pending) while the user hasn't approved yet;
 *   * 200 + access_token once they have;
 *   * 400 when the device_code is unknown/expired.
 *
 * The access_token is a Better Auth session token that the daemon's
 * Path 5 validator accepts directly — no additional exchange needed.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 44.
 */
import { NextRequest, NextResponse } from "next/server";
import { consumeDeviceCode } from "@/src/lib/device-auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { device_code?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if (!body.device_code) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const flow = consumeDeviceCode(body.device_code);
  if (!flow) {
    // Could be pending or expired; treat all "not-yet-approved" cases
    // as pending so the CLI keeps polling. /device marks the flow
    // expired after 10 minutes, at which point /authorize must be hit
    // again — the CLI surfaces that as a timeout.
    return NextResponse.json({ error: "authorization_pending" }, { status: 202 });
  }

  const expiresIn = 60 * 60 * 24; // 24h; mirrors DASHBOARD_SESSION_IDLE_SECONDS default
  return NextResponse.json({
    access_token: flow.accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    user_id: flow.userId ?? "",
    tenant_id: flow.tenantId ?? "",
  });
}
