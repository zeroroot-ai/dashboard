/**
 * Debug-mode plumbing for the dashboard.
 *
 * Activated by the helm value `dashboard.debug: true`, which sets:
 *   DASHBOARD_DEBUG=1                   (server-side)
 *   NEXT_PUBLIC_DASHBOARD_DEBUG=1       (client-side; baked at build time)
 *
 * In debug mode:
 *   - API routes wrapped with `withDebugErrors` return the full error
 *     message + stack instead of generic placeholders.
 *   - Errors are also pushed onto an in-memory ring buffer that
 *     /api/debug/recent-errors exposes as JSON.
 *   - The client-side <DebugErrorPanel/> polls that endpoint and shows
 *     errors as collapsible cards so an operator (or an LLM agent) can
 *     diagnose without leaving the browser.
 *
 * Default OFF, production users see safeErrorResponse-style messages.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const isDebug = process.env.DASHBOARD_DEBUG === "1";

export type DebugErrorRecord = {
  ts: string;
  route: string;
  method: string;
  status: number;
  message: string;
  stack?: string;
  cause?: string;
};

const MAX_BUFFER = 200;
const buffer: DebugErrorRecord[] = [];

export function recordDebugError(rec: DebugErrorRecord): void {
  buffer.push(rec);
  if (buffer.length > MAX_BUFFER) buffer.splice(0, buffer.length - MAX_BUFFER);
}

export function recentDebugErrors(): DebugErrorRecord[] {
  return [...buffer].reverse();
}

/**
 * Wrap a Next.js route handler so unhandled errors are recorded into the
 * debug ring buffer and (when debug is on) returned to the caller with
 * full message + stack. In production, callers still get a generic 500
 * with no internals leaked.
 */
export function withDebugErrors<Args extends unknown[]>(
  handler: (req: NextRequest, ...args: Args) => Promise<Response>,
): (req: NextRequest, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      const rec: DebugErrorRecord = {
        ts: new Date().toISOString(),
        route: new URL(req.url).pathname,
        method: req.method,
        status: 500,
        message: e.message,
        stack: e.stack,
        cause: e.cause ? String(e.cause) : undefined,
      };
      recordDebugError(rec);
      console.error(`[debug] ${rec.method} ${rec.route} → ${rec.message}`, e);
      if (isDebug) {
        return NextResponse.json(
          { error: { code: "INTERNAL", ...rec } },
          { status: 500 },
        );
      }
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "Internal server error" } },
        { status: 500 },
      );
    }
  };
}
