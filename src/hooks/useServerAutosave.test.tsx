/**
 * useServerAutosave — unit tests
 *
 * Covers:
 *   1. CREATE path (no draftId) → action called without draftId, status 'saved'
 *   2. UPDATE path (draftId in data) → action called WITH draftId, status 'saved'
 *   3. Auto-update after CREATE → second save reuses the created draftId
 *   4. Error path → status 'error', error field populated
 *   5. No localStorage → localStorage.getItem and .setItem never called
 *   6. Debounce → rapid cueSource changes produce exactly one action call
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useServerAutosave } from "./useServerAutosave";

// ---------------------------------------------------------------------------
// Module mock — isolate the hook from real daemon calls
// ---------------------------------------------------------------------------

vi.mock("@/app/actions/missions/drafts", () => ({
  saveMissionDraftAction: vi.fn(),
}));

// Import AFTER vi.mock so we get the mocked version.
import { saveMissionDraftAction } from "@/app/actions/missions/drafts";

const mockSaveMissionDraftAction = vi.mocked(saveMissionDraftAction);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessResult(draftId: string) {
  return Promise.resolve({ ok: true as const, data: { draftId } });
}

function makeErrorResult(error: string) {
  return Promise.resolve({
    ok: false as const,
    error,
    code: "rpc_failed" as const,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useServerAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSaveMissionDraftAction.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // 1. CREATE path ────────────────────────────────────────────────────────────

  it("CREATE path: calls saveMissionDraftAction without draftId and transitions to saved", async () => {
    const DRAFT_ID = "server-draft-001";
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult(DRAFT_ID));

    const { result } = renderHook(() =>
      useServerAutosave(
        { cueSource: 'name: "my mission"\nversion: 1' },
        { debounceMs: 1000 },
      ),
    );

    expect(result.current.status).toBe("idle");

    // Advance past the debounce window and let the async action resolve.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });

    expect(mockSaveMissionDraftAction).toHaveBeenCalledOnce();
    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.draftId).toBeUndefined();
    expect(callArgs.cueSource).toContain("my mission");

    expect(result.current.status).toBe("saved");
    expect(result.current.draftId).toBe(DRAFT_ID);
    expect(result.current.error).toBeNull();
  });

  // 2. UPDATE path ────────────────────────────────────────────────────────────

  it("UPDATE path: calls saveMissionDraftAction WITH the provided draftId", async () => {
    const EXISTING_DRAFT_ID = "existing-draft-abc";
    mockSaveMissionDraftAction.mockReturnValue(
      makeSuccessResult(EXISTING_DRAFT_ID),
    );

    const { result } = renderHook(() =>
      useServerAutosave(
        { cueSource: "version: 2", draftId: EXISTING_DRAFT_ID },
        { debounceMs: 500, name: "My Draft" },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(mockSaveMissionDraftAction).toHaveBeenCalledOnce();
    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.draftId).toBe(EXISTING_DRAFT_ID);
    expect(callArgs.name).toBe("My Draft");

    expect(result.current.status).toBe("saved");
    expect(result.current.draftId).toBe(EXISTING_DRAFT_ID);
  });

  // 3. Auto-update after CREATE ────────────────────────────────────────────────

  it("uses the created draftId on the second save after a CREATE", async () => {
    const CREATED_DRAFT_ID = "newly-created-draft-999";
    mockSaveMissionDraftAction.mockReturnValue(
      makeSuccessResult(CREATED_DRAFT_ID),
    );

    const { result, rerender } = renderHook(
      ({ cueSource }: { cueSource: string }) =>
        useServerAutosave({ cueSource }, { debounceMs: 500 }),
      { initialProps: { cueSource: "version: 1" } },
    );

    // First save (CREATE).
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(result.current.draftId).toBe(CREATED_DRAFT_ID);
    mockSaveMissionDraftAction.mockClear();

    // Second cueSource change — should trigger UPDATE with the stored draftId.
    rerender({ cueSource: "version: 2" });

    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(mockSaveMissionDraftAction).toHaveBeenCalledOnce();
    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.draftId).toBe(CREATED_DRAFT_ID);
  });

  // 4. Error path ─────────────────────────────────────────────────────────────

  it("sets status to error and populates error field when the action fails", async () => {
    mockSaveMissionDraftAction.mockReturnValue(
      makeErrorResult("daemon unreachable"),
    );

    const { result } = renderHook(() =>
      useServerAutosave(
        { cueSource: "version: 1" },
        { debounceMs: 200 },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("daemon unreachable");
    expect(result.current.draftId).toBeUndefined();
  });

  // 5. No localStorage ────────────────────────────────────────────────────────

  it("never reads from or writes to localStorage", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-ls-test"));

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    const { result } = renderHook(() =>
      useServerAutosave(
        { cueSource: "version: 1" },
        { debounceMs: 100 },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    expect(result.current.status).toBe("saved");
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });

  // 6. Debounce ───────────────────────────────────────────────────────────────

  it("debounces rapid cueSource changes into a single action call", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-debounce"));

    const { rerender } = renderHook(
      ({ cueSource }: { cueSource: string }) =>
        useServerAutosave({ cueSource }, { debounceMs: 1000 }),
      { initialProps: { cueSource: "a" } },
    );

    // Each rerender must flush React's effects so the new timer is installed
    // before we advance time. Using separate act() calls ensures the effect
    // cleanup + re-register happens between each cueSource update.

    // Advance 300ms — old timer from "a" is still pending (< 1000ms).
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Rerender "ab" — clears the "a" timer, installs a fresh 1000ms timer.
    await act(async () => {
      rerender({ cueSource: "ab" });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Rerender "abc" — clears the "ab" timer.
    await act(async () => {
      rerender({ cueSource: "abc" });
    });

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Rerender "abcd" — clears the "abc" timer.
    await act(async () => {
      rerender({ cueSource: "abcd" });
    });

    // No timer has fired yet. Advance past the 1000ms debounce window for
    // the final "abcd" render and let the async action resolve.
    await act(async () => {
      vi.advanceTimersByTime(1100);
      await Promise.resolve();
    });

    expect(mockSaveMissionDraftAction).toHaveBeenCalledOnce();
    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.cueSource).toBe("abcd");
  });

  // 7. Name parsing from CUE source ───────────────────────────────────────────

  it("parses the draft name from the CUE name: field", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-name-parse"));

    renderHook(() =>
      useServerAutosave(
        { cueSource: 'name: "Recon Mission"\nversion: 1' },
        { debounceMs: 100 },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.name).toBe("Recon Mission");
  });

  it("parses the draft name from an indented name: field inside mission: {}", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-indented-name"));

    const indentedCUE = `package mission\n\nmission: {\n\tname: "my-mission-1"\n\tdescription: "test"\n}`;
    renderHook(() =>
      useServerAutosave(
        { cueSource: indentedCUE },
        { debounceMs: 100 },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.name).toBe("my-mission-1");
  });

  it('falls back to "Untitled Draft" when no name: field is present in CUE', async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-fallback"));

    renderHook(() =>
      useServerAutosave(
        { cueSource: "version: 1\ndescription: no name here" },
        { debounceMs: 100 },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.name).toBe("Untitled Draft");
  });

  it("options.name takes precedence over the parsed CUE name", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("draft-options-name"));

    renderHook(() =>
      useServerAutosave(
        { cueSource: 'name: "CUE name"\nversion: 1' },
        { debounceMs: 100, name: "Options name" },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });

    const callArgs = mockSaveMissionDraftAction.mock.calls[0][0];
    expect(callArgs.name).toBe("Options name");
  });

  // 8. enabled: false guard ───────────────────────────────────────────────────

  it("does not schedule a save when enabled is false", async () => {
    mockSaveMissionDraftAction.mockReturnValue(makeSuccessResult("should-not-be-called"));

    renderHook(() =>
      useServerAutosave(
        { cueSource: "version: 1" },
        { debounceMs: 100, enabled: false },
      ),
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(mockSaveMissionDraftAction).not.toHaveBeenCalled();
  });
});
