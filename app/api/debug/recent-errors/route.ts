/**
 * /api/debug/recent-errors
 *
 * In-memory ring buffer of the last ~200 server-side errors. Returns 404
 * unless DASHBOARD_DEBUG=1, never expose stack traces in prod.
 *
 * Intended for `curl` from operators and LLM agents diagnosing a stuck
 * dashboard pod, plus the in-page DebugErrorPanel.
 */

import { NextResponse } from "next/server";
import { isDebug, recentDebugErrors } from "@/src/lib/debug";

export const runtime = "nodejs";

export async function GET() {
  if (!isDebug) {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json({ errors: recentDebugErrors() });
}
