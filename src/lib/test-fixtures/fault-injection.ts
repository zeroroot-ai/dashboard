/**
 * fault-injection.ts, server-side fault-injection state for e2e testing.
 *
 * ONLY active when `TEST_FIXTURES_ENABLED=true`. In any other environment
 * every exported function is a no-op / always-clear. The module is imported
 * in critical paths (membership resolution, etc.) but its overhead at
 * production call sites is a single `process.env` boolean check.
 *
 * Fault state is held in a module-level Map (process singleton). It survives
 * across requests without restarting the server, which is exactly what the
 * e2e tests need: POST /api/test/inject-fault to arm → drive a failing sign-in
 * → assert → POST again with mode="clear" to disarm.
 *
 * Subsystems that can be faulted:
 *   "fga"           , getMyMemberships() in src/lib/auth/membership.ts
 *   "jwks"          , JWKS fetch in the OIDC provider (via env-var redirect)
 *   "token-exchange", Zitadel token endpoint (via env-var redirect)
 *
 * Fault modes:
 *   "503"          , simulate HTTP 503 / gRPC Unavailable from the subsystem
 *   "malformed-200", simulate a 200 response with a body that fails parsing
 *   "timeout"      , simulate a hung request (not currently wired to sleep;
 *                     treated as equivalent to "503" for determinism)
 *   "clear"        , remove any active fault for this subsystem
 *
 * Scope:
 *   "all"          , fault persists until explicitly cleared
 *   "next-N-calls" , fault applies to the next N calls, then auto-clears
 *
 * Spec: auth-resolution-hardening (Task 14, R7).
 *
 * @module test-fixtures/fault-injection
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FaultSubsystem = "fga" | "jwks" | "token-exchange";

export type FaultMode = "503" | "malformed-200" | "timeout" | "clear";

export type FaultScope = "all" | `next-${number}-calls`;

export interface FaultEntry {
  mode: Exclude<FaultMode, "clear">;
  /** Remaining calls before auto-clear. undefined = infinite (scope="all"). */
  remaining: number | undefined;
}

export interface ActiveFault {
  mode: Exclude<FaultMode, "clear">;
  /** Call decrementIfBounded() after consuming the fault to apply scoped decay. */
  decrementIfBounded: () => void;
}

// ---------------------------------------------------------------------------
// Guard, all state is no-op when TEST_FIXTURES_ENABLED is not "true"
// ---------------------------------------------------------------------------

function isEnabled(): boolean {
  return process.env.TEST_FIXTURES_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// State singleton
// The map key is the subsystem string. We store this on globalThis so that
// Next.js HMR module reloads in dev mode don't lose active faults mid-test.
// ---------------------------------------------------------------------------

declare global {
  // eslint-disable-next-line no-var
  var __faultInjectionState: Map<FaultSubsystem, FaultEntry> | undefined;
  // Tracks the last subsystem that fired (i.e., was consumed by a getFaultMode()
  // call that returned a non-undefined fault). Lets middleware differentiate
  // Auth.js ?error=Callback into the correct LoginErrorReason without needing
  // to parse the error message itself.
  // eslint-disable-next-line no-var
  var __faultLastFired: FaultSubsystem | undefined;
}

function getState(): Map<FaultSubsystem, FaultEntry> {
  if (!globalThis.__faultInjectionState) {
    globalThis.__faultInjectionState = new Map();
  }
  return globalThis.__faultInjectionState;
}

/**
 * Returns the subsystem that most recently fired a fault, then clears the
 * last-fired record. Used by the middleware to differentiate Auth.js
 * ?error=Callback into the correct LoginErrorReason.
 */
export function popLastFiredSubsystem(): FaultSubsystem | undefined {
  if (!isEnabled()) return undefined;
  const last = globalThis.__faultLastFired;
  globalThis.__faultLastFired = undefined;
  return last;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set a fault for a subsystem. Called by the /api/test/inject-fault handler.
 * Silently no-ops when TEST_FIXTURES_ENABLED is not "true".
 */
export function setFault(
  subsystem: FaultSubsystem,
  mode: FaultMode,
  scope: FaultScope = "all",
): void {
  if (!isEnabled()) return;

  if (mode === "clear") {
    getState().delete(subsystem);
    return;
  }

  let remaining: number | undefined;
  if (scope !== "all") {
    // Parse "next-N-calls"
    const match = scope.match(/^next-(\d+)-calls$/);
    remaining = match ? parseInt(match[1], 10) : undefined;
  }

  getState().set(subsystem, { mode, remaining });
}

/**
 * Clear a specific subsystem fault or ALL faults (omit subsystem).
 * Silently no-ops when TEST_FIXTURES_ENABLED is not "true".
 */
export function clearFault(subsystem?: FaultSubsystem): void {
  if (!isEnabled()) return;
  if (subsystem) {
    getState().delete(subsystem);
  } else {
    getState().clear();
  }
}

/**
 * Read the active fault for a subsystem, if any.
 *
 * Returns undefined when:
 *   - TEST_FIXTURES_ENABLED is not "true", OR
 *   - no fault is set for this subsystem, OR
 *   - the scoped fault has been exhausted
 *
 * The returned ActiveFault.decrementIfBounded() MUST be called by the
 * caller after it has consumed / acted on the fault (i.e., after it has
 * arranged to return the error or malformed response). Calling it before
 * returning allows the next call through if the scope is exhausted.
 *
 * @example
 * const fault = getFaultMode("fga");
 * if (fault) {
 *   fault.decrementIfBounded();
 *   throw new MembershipResolutionError("fga_unavailable");
 * }
 * // proceed with real FGA call
 */
export function getFaultMode(subsystem: FaultSubsystem): ActiveFault | undefined {
  if (!isEnabled()) return undefined;

  const state = getState();
  const entry = state.get(subsystem);
  if (!entry) return undefined;

  // Scoped fault already exhausted, clean up and return undefined.
  if (entry.remaining !== undefined && entry.remaining <= 0) {
    state.delete(subsystem);
    return undefined;
  }

  // Record which subsystem is firing so middleware can differentiate errors.
  globalThis.__faultLastFired = subsystem;

  return {
    mode: entry.mode,
    decrementIfBounded: () => {
      if (entry.remaining !== undefined) {
        entry.remaining -= 1;
        if (entry.remaining <= 0) {
          state.delete(subsystem);
        }
      }
    },
  };
}

/**
 * Return all currently-active faults. Used by the inject-fault GET handler
 * to allow tests to inspect current state.
 */
export function listFaults(): Record<string, { mode: string; remaining: number | undefined }> {
  if (!isEnabled()) return {};
  const out: Record<string, { mode: string; remaining: number | undefined }> = {};
  for (const [k, v] of getState()) {
    out[k] = { mode: v.mode, remaining: v.remaining };
  }
  return out;
}
