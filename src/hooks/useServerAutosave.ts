"use client";

/**
 * useServerAutosave Hook
 *
 * Debounced autosave to the daemon's draft API.
 *
 * Features:
 * - 30-second debounce (configurable)
 * - CREATE path on first save (no draftId), UPDATE path on subsequent saves
 * - Draft name parsed from CUE `name:` field or provided via options.name
 * - Persists the server-assigned draftId in a ref to avoid re-render loops
 * - Zero localStorage reads or writes
 *
 * Spec: mission-draft-dashboard-wiring.
 */

import * as React from "react";

import { saveMissionDraftAction } from "@/app/actions/missions/drafts";

// ============================================================================
// Types
// ============================================================================

export interface UseServerAutosaveOptions {
  /** Debounce delay in milliseconds. Default: 30000 (30 seconds). */
  debounceMs?: number;
  /**
   * Draft name. When provided it takes precedence over the `name:` field
   * parsed from cueSource. Falls back to "Untitled Draft".
   */
  name?: string;
  /** Whether autosave is active. Default: true. */
  enabled?: boolean;
}

export interface UseServerAutosaveReturn {
  status: "idle" | "saving" | "saved" | "error";
  /** The server-assigned draft ID. Undefined until the first successful save. */
  draftId: string | undefined;
  /** Error message when status is 'error'. */
  error: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 30000;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract the `name:` field from a CUE source snippet using a simple regex.
 * Returns undefined when not found.
 */
function parseCueName(cueSource: string): string | undefined {
  const match = /^name:\s*["']?([^"'\n]+)["']?/m.exec(cueSource);
  return match?.[1]?.trim() || undefined;
}

// ============================================================================
// Hook
// ============================================================================

export function useServerAutosave(
  data: { cueSource: string; draftId?: string },
  options?: UseServerAutosaveOptions,
): UseServerAutosaveReturn {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    name: optionsName,
    enabled = true,
  } = options ?? {};

  const [status, setStatus] = React.useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = React.useState<string | null>(null);

  // Store the server-assigned draftId in a ref so we can carry it across
  // timer firings without triggering re-renders on write.
  const activeDraftIdRef = React.useRef<string | undefined>(undefined);

  // Expose the current activeDraftId as stable state so consumers can react
  // to the first CREATE completing. We update this via a separate state slot
  // only when the value actually changes to avoid extra renders.
  const [exposedDraftId, setExposedDraftId] = React.useState<
    string | undefined
  >(data.draftId);

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a stable ref to the latest data so the timer callback always sees
  // the current values without needing to be re-scheduled on every keystroke.
  const latestDataRef = React.useRef(data);
  latestDataRef.current = data;

  const latestOptionsRef = React.useRef({ debounceMs, optionsName, enabled });
  latestOptionsRef.current = { debounceMs, optionsName, enabled };

  // Perform the actual save — must not close over stale data.
  const performSave = React.useCallback(async () => {
    const { cueSource, draftId: propDraftId } = latestDataRef.current;
    const { optionsName: optName } = latestOptionsRef.current;

    const draftName =
      optName ?? parseCueName(cueSource) ?? "Untitled Draft";

    const resolvedDraftId = activeDraftIdRef.current ?? propDraftId;

    setStatus("saving");
    setError(null);

    const result = await saveMissionDraftAction({
      name: draftName,
      cueSource,
      ...(resolvedDraftId !== undefined ? { draftId: resolvedDraftId } : {}),
    });

    if (result.ok) {
      // Store the returned draftId in the ref immediately; only update
      // React state if the value changed (to avoid unnecessary re-renders).
      if (activeDraftIdRef.current !== result.data.draftId) {
        activeDraftIdRef.current = result.data.draftId;
        setExposedDraftId(result.data.draftId);
      }
      setStatus("saved");
    } else {
      setStatus("error");
      setError(result.error);
    }
  }, []);

  // Debounced trigger: reschedule on every cueSource change.
  React.useEffect(() => {
    if (!enabled || !data.cueSource) return;

    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      void performSave();
    }, debounceMs);

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
    // We intentionally only re-run on cueSource + debounceMs + enabled.
    // performSave is stable (useCallback with no deps); the ref closure
    // guarantees it sees the latest options/data when the timer fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cueSource, debounceMs, enabled]);

  // Propagate an externally provided draftId (e.g. URL-driven restore)
  // into our ref on mount and when it changes, so UPDATE path works even
  // before our own CREATE has fired.
  React.useEffect(() => {
    if (data.draftId !== undefined && activeDraftIdRef.current === undefined) {
      activeDraftIdRef.current = data.draftId;
      setExposedDraftId(data.draftId);
    }
  }, [data.draftId]);

  return {
    status,
    draftId: exposedDraftId,
    error,
  };
}

export default useServerAutosave;
