/**
 * useMissionTerminal hook tests (dashboard#384)
 *
 * Covers:
 *   - Status events write correct ANSI lines to the terminal ref
 *   - tool_started and tool_completed write tool lines
 *   - error frame writes a red error line
 *   - Terminal-status events (completed, failed, stopped) close the EventSource
 *   - When missionId is undefined, no EventSource is opened
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMissionTerminal } from "../useMissionTerminal";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";
import * as React from "react";

// ---------------------------------------------------------------------------
// FakeEventSource
// ---------------------------------------------------------------------------

class FakeEventSource {
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  closeSpy = vi.fn();

  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners[name] = [...(this.listeners[name] ?? []), fn];
  }

  close() {
    this.closeSpy();
  }

  emit(name: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners[name]?.forEach((fn) => fn(ev));
  }
}

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

let fakeES: FakeEventSource;

// A constructor-compatible EventSource mock that returns the current fakeES.
// Using a plain function (not an arrow function) so `new EventSourceMock()`
// works and sets `this` to fakeES via Object.assign.
function EventSourceMock(this: FakeEventSource, _url: string) {
  Object.assign(this, fakeES);
}
EventSourceMock.prototype = FakeEventSource.prototype;

beforeEach(() => {
  fakeES = new FakeEventSource();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).EventSource = EventSourceMock;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRef(writeMock: (text: string) => void): React.RefObject<MissionTerminalHandle | null> {
  return {
    current: {
      write: writeMock,
      clear: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useMissionTerminal", () => {
  it("writes the green running line on status: running, then green completed on status: completed", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-abc", ref));

    act(() => {
      fakeES.emit("status", { missionId: "mission-abc", status: "running" });
    });

    expect(writeMock).toHaveBeenCalledWith(
      "\x1b[32m▶ Mission running\x1b[0m\r\n",
    );

    act(() => {
      fakeES.emit("status", { missionId: "mission-abc", status: "completed" });
    });

    expect(writeMock).toHaveBeenCalledWith(
      "\x1b[32m✓ Mission completed\x1b[0m\r\n",
    );
  });

  it("writes tool started and tool completed lines for tool events", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-tools", ref));

    act(() => {
      fakeES.emit("tool_started", { toolName: "bash", invocationId: "abc" });
    });

    act(() => {
      fakeES.emit("tool_completed", { invocationId: "abc" });
    });

    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(writeMock).toHaveBeenNthCalledWith(
      1,
      "\x1b[33m⚙ Tool: bash\x1b[0m\r\n",
    );
    expect(writeMock).toHaveBeenNthCalledWith(
      2,
      "\x1b[33m  ↳ completed\x1b[0m\r\n",
    );
  });

  it("writes a coloured, timestamped line on a log frame", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-log", ref));

    act(() => {
      fakeES.emit("log", {
        timestamp: "2024-01-01T10:30:45.000Z",
        level: "info",
        message: "agent started",
      });
    });

    expect(writeMock).toHaveBeenCalledTimes(1);
    const line = writeMock.mock.calls[0][0] as string;
    expect(line).toContain("[INF]");
    expect(line).toContain("agent started");
    expect(line.endsWith("\r\n")).toBe(true);
  });

  it("writes a red error line on an error frame", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-err", ref));

    act(() => {
      fakeES.emit("error", { message: "RPC failed" });
    });

    expect(writeMock).toHaveBeenCalledWith("\x1b[31m! RPC failed\x1b[0m\r\n");
  });

  it("calls es.close() when status: failed is emitted", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-fail", ref));

    act(() => {
      fakeES.emit("status", { missionId: "mission-fail", status: "failed" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
  });

  it("calls es.close() when status: stopped is emitted", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-stop", ref));

    act(() => {
      fakeES.emit("status", { missionId: "mission-stop", status: "stopped" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
  });

  it("calls es.close() when status: completed is emitted", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-done", ref));

    act(() => {
      fakeES.emit("status", { missionId: "mission-done", status: "completed" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
  });

  it("does not open an EventSource when missionId is undefined", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    const EventSourceConstructor = vi.fn(() => fakeES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).EventSource = EventSourceConstructor;

    renderHook(() => useMissionTerminal(undefined, ref));

    expect(EventSourceConstructor).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("does not write for status: pending (silent)", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useMissionTerminal("mission-pending", ref));

    act(() => {
      fakeES.emit("status", { missionId: "mission-pending", status: "pending" });
    });

    expect(writeMock).not.toHaveBeenCalled();
  });
});
