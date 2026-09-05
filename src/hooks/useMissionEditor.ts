"use client";

/**
 * useMissionEditor, the mission-authoring editor state machine.
 *
 * Owns every piece of editor state behind one small, testable interface so the
 * page is a thin view: source + dirty tracking, debounced autosave (short
 * debounce, not the old 30s lag), an explicit save(), compile-diagnostic count,
 * the saved-mission id/name, and run() launching.
 *
 * Persistence currently rides the saved-mission source store (the rebrand of
 * the draft RPCs lands in dashboard#496/D5); running rides
 * createMissionFromCUEAction (made iteration-safe in dashboard#494/D3). This
 * hook owns the create-vs-update decision for autosave: the first successful
 * save assigns an id, later saves update in place.
 *
 * dashboard#493 (D2).
 */

import * as React from "react";

import { saveMissionSourceAction } from "@/app/actions/missions/source-store";
import { createMissionFromCUEAction } from "@/app/actions/missions/create-mission";
import { NEW_MISSION_CUE } from "@/src/data/new-mission-template";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type RunState = "idle" | "launching";

const DEFAULT_DEBOUNCE_MS = 2500;
const FALLBACK_NAME = "Untitled Mission";

interface UseMissionEditorOptions {
  /** Debounce delay for autosave in ms. Default 2500. Tests pass 0. */
  debounceMs?: number;
  /** Whether autosave is active. Default true. */
  autosave?: boolean;
}

interface MissionEditorApi {
  // ── state ──
  cueSource: string;
  isDirty: boolean;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Count of error-severity CUE diagnostics; gates Run. */
  errorCount: number;
  /** Server-assigned saved-mission id; undefined until the first save. */
  missionId: string | undefined;
  missionName: string | undefined;
  runState: RunState;
  runError: string | null;
  /** The id of the most recently launched run, for wiring the terminal. */
  activeMissionId: string | undefined;
  /** True when Run should be disabled: a launch is in flight or CUE has errors. */
  runDisabled: boolean;

  // ── commands ──
  setSource: (cue: string) => void;
  setErrorCount: (n: number) => void;
  setMissionName: (name: string) => void;
  /** Reset to a fresh, valid New Mission template with no id. */
  newMission: () => void;
  /** Hydrate the editor from a loaded saved mission / template / clone. */
  loadSource: (args: {
    id?: string;
    name?: string;
    cueSource: string;
  }) => void;
  /** Force an immediate save, bypassing the debounce. Resolves with success. */
  save: () => Promise<{ ok: boolean }>;
  /** Validate + launch a run from the current source. */
  run: () => Promise<{ ok: boolean; missionId?: string; error?: string }>;
}

/** Extract the `name:` field from CUE source. Returns undefined when absent. */
function parseCueName(cueSource: string): string | undefined {
  const match = /^\s*name:\s*["']?([^"'\n]+)["']?/m.exec(cueSource);
  return match?.[1]?.trim() || undefined;
}

export function useMissionEditor(
  options?: UseMissionEditorOptions,
): MissionEditorApi {
  const { debounceMs = DEFAULT_DEBOUNCE_MS, autosave = true } = options ?? {};

  const [cueSource, setCueSourceState] = React.useState<string>(NEW_MISSION_CUE);
  const [savedSource, setSavedSource] = React.useState<string>(NEW_MISSION_CUE);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [errorCount, setErrorCountState] = React.useState(0);
  const [missionId, setMissionId] = React.useState<string | undefined>(undefined);
  const [missionName, setMissionNameState] = React.useState<string | undefined>(
    undefined,
  );
  const [runState, setRunState] = React.useState<RunState>("idle");
  const [runError, setRunError] = React.useState<string | null>(null);
  const [activeMissionId, setActiveMissionId] = React.useState<
    string | undefined
  >(undefined);

  const isDirty = cueSource !== savedSource;

  // Refs so the debounce timer always sees the latest values without being
  // rescheduled on every keystroke (ref-snapshot debounce pattern).
  const latest = React.useRef({ cueSource, missionId, missionName });
  latest.current = { cueSource, missionId, missionName };
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The core save primitive. Snapshots the source it persists so savedSource
  // reflects exactly what was written, even if the user keeps typing. Returns
  // whether the save succeeded so callers can toast accurately.
  const persist = React.useCallback(async (): Promise<boolean> => {
    const { cueSource: src, missionId: id, missionName: nm } = latest.current;
    if (!src) return false;
    const name = nm ?? parseCueName(src) ?? FALLBACK_NAME;

    setSaveStatus("saving");
    setSaveError(null);

    const result = await saveMissionSourceAction({
      name,
      cueSource: src,
      ...(id !== undefined ? { draftId: id } : {}),
    });

    if (result.ok) {
      if (id === undefined) setMissionId(result.data.draftId);
      setSavedSource(src);
      setSaveStatus("saved");
      return true;
    }
    setSaveStatus("error");
    setSaveError(result.error);
    return false;
  }, []);

  // Debounced autosave: reschedule on every source change while dirty.
  React.useEffect(() => {
    if (!autosave || !isDirty || !cueSource) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void persist(), debounceMs);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
    // Reschedule only when the source or dirtiness changes; persist is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cueSource, isDirty, autosave, debounceMs]);

  const setSource = React.useCallback((cue: string) => {
    setCueSourceState(cue);
  }, []);

  const setErrorCount = React.useCallback((n: number) => {
    setErrorCountState(n);
  }, []);

  const setMissionName = React.useCallback((name: string) => {
    setMissionNameState(name);
  }, []);

  const newMission = React.useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setCueSourceState(NEW_MISSION_CUE);
    setSavedSource(NEW_MISSION_CUE);
    setMissionId(undefined);
    setMissionNameState(undefined);
    setSaveStatus("idle");
    setSaveError(null);
    setActiveMissionId(undefined);
    setRunState("idle");
    setRunError(null);
  }, []);

  const loadSource = React.useCallback(
    (args: { id?: string; name?: string; cueSource: string }) => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setCueSourceState(args.cueSource);
      setSavedSource(args.cueSource);
      setMissionId(args.id);
      setMissionNameState(args.name);
      setSaveStatus(args.id !== undefined ? "saved" : "idle");
      setSaveError(null);
      setActiveMissionId(undefined);
      setRunState("idle");
      setRunError(null);
    },
    [],
  );

  const save = React.useCallback(async (): Promise<{ ok: boolean }> => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const ok = await persist();
    return { ok };
  }, [persist]);

  const run = React.useCallback(async () => {
    setRunState("launching");
    setRunError(null);
    setActiveMissionId(undefined);
    try {
      const res = await createMissionFromCUEAction({
        cueSource: latest.current.cueSource,
      });
      if (!res.ok) {
        setRunError(res.error);
        return { ok: false as const, error: res.error };
      }
      setActiveMissionId(res.missionId);
      return { ok: true as const, missionId: res.missionId };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setRunError(message);
      return { ok: false as const, error: message };
    } finally {
      setRunState("idle");
    }
  }, []);

  return {
    cueSource,
    isDirty,
    saveStatus,
    saveError,
    errorCount,
    missionId,
    missionName,
    runState,
    runError,
    activeMissionId,
    runDisabled: runState !== "idle" || errorCount > 0,
    setSource,
    setErrorCount,
    setMissionName,
    newMission,
    loadSource,
    save,
    run,
  };
}

