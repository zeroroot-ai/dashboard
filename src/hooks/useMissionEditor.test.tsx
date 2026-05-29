/**
 * useMissionEditor — unit tests (dashboard#493 / D2).
 *
 * Covers the externally observable behavior of the editor state machine:
 *   1. newMission loads a valid template (errorCount 0, Run enabled)
 *   2. loadSource hydrates source + id and clears dirty
 *   3. editing sets dirty, then debounced autosave drives saving → saved
 *   4. first save assigns an id (CREATE); later saves update in place (UPDATE)
 *   5. a compile error (errorCount > 0) disables Run
 *   6. save() forces an immediate persist, bypassing the debounce
 *   7. run() launching gates Run, then returns to idle; success sets activeMissionId
 *   8. run() failure surfaces runError and re-enables Run
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

import { useMissionEditor } from "./useMissionEditor";
import { NEW_MISSION_CUE } from "@/src/data/new-mission-template";

vi.mock("@/app/actions/missions/source-store", () => ({
  saveMissionSourceAction: vi.fn(),
}));
vi.mock("@/app/actions/missions/create-mission", () => ({
  createMissionFromCUEAction: vi.fn(),
}));

import { saveMissionSourceAction } from "@/app/actions/missions/source-store";
import { createMissionFromCUEAction } from "@/app/actions/missions/create-mission";

const mockSave = vi.mocked(saveMissionSourceAction);
const mockRun = vi.mocked(createMissionFromCUEAction);

describe("useMissionEditor", () => {
  beforeEach(() => {
    mockSave.mockReset();
    mockRun.mockReset();
  });

  it("starts on a valid New Mission template with Run enabled", () => {
    const { result } = renderHook(() => useMissionEditor({ autosave: false }));
    expect(result.current.cueSource).toBe(NEW_MISSION_CUE);
    expect(result.current.errorCount).toBe(0);
    expect(result.current.runDisabled).toBe(false);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.missionId).toBeUndefined();
  });

  it("loadSource hydrates source + id and is not dirty", () => {
    const { result } = renderHook(() => useMissionEditor({ autosave: false }));
    act(() => {
      result.current.loadSource({
        id: "m-1",
        name: "alpha",
        cueSource: "mission: {}",
      });
    });
    expect(result.current.cueSource).toBe("mission: {}");
    expect(result.current.missionId).toBe("m-1");
    expect(result.current.missionName).toBe("alpha");
    expect(result.current.isDirty).toBe(false);
    expect(result.current.saveStatus).toBe("saved");
  });

  it("editing flips dirty; debounced autosave drives saving → saved and assigns an id", async () => {
    mockSave.mockResolvedValue({ ok: true, data: { draftId: "new-id" } });
    const { result } = renderHook(() => useMissionEditor({ debounceMs: 0 }));

    act(() => result.current.setSource("mission: { name: \"x\" }"));
    expect(result.current.isDirty).toBe(true);

    await waitFor(() => expect(result.current.saveStatus).toBe("saved"));
    expect(mockSave).toHaveBeenCalledTimes(1);
    // CREATE: no draftId in the first call.
    expect(mockSave.mock.calls[0][0]).not.toHaveProperty("draftId");
    expect(result.current.missionId).toBe("new-id");
    expect(result.current.isDirty).toBe(false);
  });

  it("updates in place once an id exists (UPDATE path)", async () => {
    mockSave
      .mockResolvedValueOnce({ ok: true, data: { draftId: "id-1" } })
      .mockResolvedValueOnce({ ok: true, data: { draftId: "id-1" } });
    const { result } = renderHook(() => useMissionEditor({ debounceMs: 0 }));

    act(() => result.current.setSource("mission: { name: \"a\" }"));
    await waitFor(() => expect(result.current.missionId).toBe("id-1"));

    act(() => result.current.setSource("mission: { name: \"b\" }"));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(2));
    // UPDATE: second call carries the assigned id.
    expect(mockSave.mock.calls[1][0]).toMatchObject({ draftId: "id-1" });
  });

  it("surfaces a save error", async () => {
    mockSave.mockResolvedValue({
      ok: false,
      error: "daemon down",
      code: "rpc_failed",
    });
    const { result } = renderHook(() => useMissionEditor({ debounceMs: 0 }));
    act(() => result.current.setSource("mission: { name: \"x\" }"));
    await waitFor(() => expect(result.current.saveStatus).toBe("error"));
    expect(result.current.saveError).toBe("daemon down");
  });

  it("disables Run when there are compile errors", () => {
    const { result } = renderHook(() => useMissionEditor({ autosave: false }));
    act(() => result.current.setErrorCount(2));
    expect(result.current.runDisabled).toBe(true);
    act(() => result.current.setErrorCount(0));
    expect(result.current.runDisabled).toBe(false);
  });

  it("save() persists immediately without waiting for the debounce", async () => {
    mockSave.mockResolvedValue({ ok: true, data: { draftId: "id-x" } });
    const { result } = renderHook(() =>
      useMissionEditor({ debounceMs: 999_999 }),
    );
    act(() => result.current.setSource("mission: { name: \"now\" }"));
    await act(async () => {
      await result.current.save();
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.missionId).toBe("id-x");
  });

  it("run() gates Run while launching, sets activeMissionId on success, returns to idle", async () => {
    mockRun.mockResolvedValue({ ok: true, missionId: "run-9" });
    const { result } = renderHook(() => useMissionEditor({ autosave: false }));

    let runResult: { ok: boolean; missionId?: string } | undefined;
    await act(async () => {
      runResult = await result.current.run();
    });
    expect(runResult).toEqual({ ok: true, missionId: "run-9" });
    expect(result.current.activeMissionId).toBe("run-9");
    expect(result.current.runState).toBe("idle");
    expect(result.current.runDisabled).toBe(false);
  });

  it("run() failure surfaces runError and leaves Run enabled", async () => {
    mockRun.mockResolvedValue({
      ok: false,
      error: "CUE invalid",
      code: "invalid",
    });
    const { result } = renderHook(() => useMissionEditor({ autosave: false }));
    await act(async () => {
      const r = await result.current.run();
      expect(r.ok).toBe(false);
    });
    expect(result.current.runError).toBe("CUE invalid");
    expect(result.current.runState).toBe("idle");
  });
});
