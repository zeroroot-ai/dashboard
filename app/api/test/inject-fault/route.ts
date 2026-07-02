/**
 * /api/test/inject-fault, server-side fault-injection control endpoint.
 *
 * ONLY active when `TEST_FIXTURES_ENABLED=true`. Returns 404 in all other
 * environments (production, staging, any build where the env var is absent
 * or not exactly "true"). The guard is enforced at the very top of every
 * handler before any state is read or written.
 *
 * This endpoint is the control plane for the e2e fault-injection harness
 * (auth-resolution-hardening Task 14). The e2e tests POST to this endpoint
 * to arm a fault before driving a sign-in attempt, then POST again with
 * mode="clear" to disarm after assertions.
 *
 * POST /api/test/inject-fault
 *   Body (JSON):
 *     subsystem , "fga" | "jwks" | "token-exchange"
 *     mode      , "503" | "malformed-200" | "timeout" | "clear"
 *     scope     , "all" | "next-N-calls"  (default: "all")
 *
 *   Response 200 { ok: true, subsystem, mode, scope }
 *   Response 400 { error: "..." } , invalid body
 *   Response 404                  , TEST_FIXTURES_ENABLED != "true"
 *
 * GET /api/test/inject-fault
 *   Returns 200 { faults: { [subsystem]: { mode, remaining } } } so tests
 *   can inspect active faults without needing side-channel knowledge.
 *   Returns 404 when not enabled.
 *
 * Spec: auth-resolution-hardening, Task 14 (primitive 1).
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  setFault,
  listFaults,
  type FaultSubsystem,
  type FaultMode,
  type FaultScope,
} from "@/src/lib/test-fixtures/fault-injection";

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
// Validation
// ---------------------------------------------------------------------------

const VALID_SUBSYSTEMS: ReadonlySet<string> = new Set(["fga", "jwks", "token-exchange"]);
const VALID_MODES: ReadonlySet<string> = new Set(["503", "malformed-200", "timeout", "clear"]);

function parseScope(raw: unknown): FaultScope | null {
  if (raw === undefined || raw === null || raw === "all") return "all";
  if (typeof raw !== "string") return null;
  if (raw === "all") return "all";
  const m = raw.match(/^next-(\d+)-calls$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 10_000) return `next-${n}-calls` as FaultScope;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  if (!isEnabled()) return notEnabled();
  return NextResponse.json({ faults: listFaults() });
}

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

  const { subsystem, mode, scope: rawScope } = body as Record<string, unknown>;

  if (!VALID_SUBSYSTEMS.has(subsystem as string)) {
    return NextResponse.json(
      { error: `subsystem must be one of: ${[...VALID_SUBSYSTEMS].join(", ")}` },
      { status: 400 },
    );
  }

  if (!VALID_MODES.has(mode as string)) {
    return NextResponse.json(
      { error: `mode must be one of: ${[...VALID_MODES].join(", ")}` },
      { status: 400 },
    );
  }

  const scope = parseScope(rawScope);
  if (scope === null) {
    return NextResponse.json(
      { error: 'scope must be "all" or "next-N-calls" where N is a positive integer' },
      { status: 400 },
    );
  }

  setFault(subsystem as FaultSubsystem, mode as FaultMode, scope);

  return NextResponse.json({
    ok: true,
    subsystem,
    mode,
    scope,
    faults: listFaults(),
  });
}
