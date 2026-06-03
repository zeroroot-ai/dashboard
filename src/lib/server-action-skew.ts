"use client";

/**
 * Server Action deployment-skew detection + recovery.
 *
 * Next.js assigns content-derived IDs to Server Actions at build time. Every
 * dashboard rebuild that shifts the module graph rotates those IDs. A browser
 * tab whose client bundle was loaded from a PREVIOUS build then POSTs an
 * action ID the running build no longer has, and Next throws at the dispatch
 * layer (before the action body ever runs):
 *
 *   Failed to find Server Action "<hash>". This request might be from an
 *   older or newer deployment.
 *
 * That rejection surfaces to the caller's `catch`, where — without this
 * helper — it becomes a generic "Something went wrong, please try again"
 * toast. Retrying from the SAME stale tab re-sends the SAME dead action ID
 * and fails forever; only a full reload (which fetches the current build's
 * bundle, with valid action IDs) recovers it.
 *
 * IMPORTANT: pinning `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` does NOT prevent
 * this. That key only stabilises encryption of an action's bound arguments
 * (and avoids decrypt mismatch across replicas); it does not freeze action
 * IDs across code-changing rebuilds. Deployment skew is inherent to rolling
 * a Next.js app, so every caller of a Server Action must handle it.
 */

/** sessionStorage key holding the timestamp of the last skew-triggered reload. */
const RELOAD_MARKER = "gibson:sa-skew-reloaded-at";

/** Suppress a second auto-reload within this window to avoid reload loops. */
const RELOAD_LOOP_GUARD_MS = 15_000;

/**
 * True when `err` is Next.js's "Failed to find Server Action" deployment-skew
 * error — i.e. the tab's client bundle predates the running build.
 */
export function isServerActionDeploymentSkew(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Failed to find Server Action/i.test(msg) ||
    /older or newer deployment/i.test(msg)
  );
}

/**
 * Reload the page to pick up the current build's client bundle.
 *
 * Returns `true` if a reload was triggered, `false` if it was suppressed
 * because we already reloaded within {@link RELOAD_LOOP_GUARD_MS} (the reload
 * didn't fix it — reloading again would loop). Callers should show a
 * "please refresh" message when this returns `false`.
 */
export function reloadForDeploymentSkew(): boolean {
  if (typeof window === "undefined") return false;

  const now = Date.now();
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_MARKER) ?? "0");
    if (Number.isFinite(last) && now - last < RELOAD_LOOP_GUARD_MS) {
      return false;
    }
    window.sessionStorage.setItem(RELOAD_MARKER, String(now));
  } catch {
    // sessionStorage unavailable (private mode, blocked storage). Without the
    // loop guard we accept the small risk of a double-reload and proceed.
  }

  window.location.reload();
  return true;
}
