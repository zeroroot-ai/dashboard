/**
 * POST /api/auth/device/authorize
 *
 * RFC 8628 Device Authorization Grant, step 1. gibson-mcp posts a
 * tenant-scope request; we mint a device_code + user_code and return
 * them. The CLI prints the verification URI for the human to visit,
 * then polls /api/auth/device/token until approval happens.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 44.
 */
import { NextRequest, NextResponse } from "next/server";
import { newDeviceFlow } from "@/src/lib/device-auth-store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { tenant?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // Empty body is fine.
  }
  const flow = newDeviceFlow(body.tenant);

  // verification_uri is the page the human visits; verification_uri_complete
  // is the user-code-prefilled variant, included per RFC 8628 §3.2.
  const base =
    process.env.DASHBOARD_PUBLIC_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";
  return NextResponse.json({
    device_code: flow.deviceCode,
    user_code: flow.userCode,
    verification_uri: `${base}/dashboard/device`,
    verification_uri_complete: `${base}/dashboard/device?code=${encodeURIComponent(flow.userCode)}`,
    expires_in: Math.floor((flow.expiresAt - Date.now()) / 1000),
    interval: flow.interval,
  });
}
