/**
 * useAgentConsole hook tests (ADR-0016 S12, dashboard#1134).
 *
 * Covers:
 *   - A `chunk` frame decodes its base64 and writes the reassembled line.
 *   - NDJSON lines that split across two chunks are reassembled correctly.
 *   - `end` / `notfound` close the EventSource and write a status line.
 *   - A NAMED `error` frame (carries data) closes; a NATIVE error (no data,
 *     an EventSource reconnect) does NOT close.
 *   - When runId is undefined, no EventSource is opened.
 *   - stream-json lines render readable (dashboard#1144), and the returned
 *     status tracks the phase and the summary facts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentConsole } from "../useAgentConsole";
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

  /** Emits a named SSE frame carrying a JSON string payload. */
  emit(name: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    this.listeners[name]?.forEach((fn) => fn(ev));
  }

  /** Emits a raw frame whose `data` is set verbatim (or omitted). */
  emitRaw(name: string, data?: string) {
    const ev = { data } as MessageEvent;
    this.listeners[name]?.forEach((fn) => fn(ev));
  }
}

let fakeES: FakeEventSource;

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

function makeRef(
  writeMock: (text: string) => void,
): React.RefObject<MissionTerminalHandle | null> {
  return {
    current: {
      write: writeMock,
      clear: vi.fn(),
    },
  };
}

/** base64 of a UTF-8 string (Node Buffer is available in the test runtime). */
function b64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

describe("useAgentConsole", () => {
  it("decodes a chunk frame and writes the reassembled line", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-1", ref));

    act(() => {
      fakeES.emit("chunk", { unixNanos: "1", dataB64: b64("hello world\n") });
    });

    expect(writeMock).toHaveBeenCalledWith("hello world\r\n");
  });

  it("reassembles a line split across two chunks", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);
    renderHook(() => useAgentConsole("run-split", ref));

    act(() => {
      fakeES.emit("chunk", { dataB64: b64("round-1-d") });
    });
    // Nothing complete yet, so nothing is written.
    expect(writeMock).not.toHaveBeenCalled();

    act(() => {
      fakeES.emit("chunk", { dataB64: b64("one\n") });
    });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith("round-1-done\r\n");
  });

  it("writes two lines when a chunk carries two records", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);
    renderHook(() => useAgentConsole("run-two", ref));

    act(() => {
      fakeES.emit("chunk", { dataB64: b64("first\nsecond\n") });
    });

    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(writeMock).toHaveBeenNthCalledWith(1, "first\r\n");
    expect(writeMock).toHaveBeenNthCalledWith(2, "second\r\n");
  });

  it("closes the EventSource and writes the finished line on end", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-end", ref));

    act(() => {
      fakeES.emit("end", { runId: "run-end" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith("\x1b[32m✓ Agent finished\x1b[0m\r\n");
  });

  it("flushes a trailing partial line when the stream ends", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-partial", ref));

    act(() => {
      fakeES.emit("chunk", { dataB64: b64("no newline here") });
    });
    expect(writeMock).not.toHaveBeenCalled();

    act(() => {
      fakeES.emit("end", { runId: "run-partial" });
    });

    // The trailing partial is flushed, then the finished line.
    expect(writeMock).toHaveBeenNthCalledWith(1, "no newline here\r\n");
    expect(writeMock).toHaveBeenNthCalledWith(
      2,
      "\x1b[32m✓ Agent finished\x1b[0m\r\n",
    );
  });

  it("closes and writes the not-running line on notfound", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-gone", ref));

    act(() => {
      fakeES.emit("notfound", { runId: "run-gone" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith(
      "\x1b[33m⏹ Agent is no longer running\x1b[0m\r\n",
    );
  });

  it("closes on a named error frame (carries data)", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-err", ref));

    act(() => {
      fakeES.emit("error", { message: "stream unavailable" });
    });

    expect(fakeES.closeSpy).toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith("\x1b[31m✗ Stream error\x1b[0m\r\n");
  });

  it("does NOT close on a native error event (no data, a reconnect)", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-flaky", ref));

    act(() => {
      fakeES.emitRaw("error", undefined);
    });

    expect(fakeES.closeSpy).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("does not open an EventSource when runId is undefined", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    const EventSourceConstructor = vi.fn(() => fakeES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).EventSource = EventSourceConstructor;

    renderHook(() => useAgentConsole(undefined, ref));

    expect(EventSourceConstructor).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("renders a stream-json assistant line readable and reports the model", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);
    const { result } = renderHook(() => useAgentConsole("run-json", ref));
    expect(result.current).toEqual({ phase: "streaming", summary: {} });
    act(() => {
      fakeES.emit("chunk", {
        dataB64: b64(
          JSON.stringify({
            type: "assistant",
            message: {
              model: "claude-opus-5",
              content: [{ type: "text", text: "hello" }],
            },
          }) + "\n",
        ),
      });
    });
    expect(writeMock).toHaveBeenCalledWith("hello\r\n");
    expect(result.current.summary).toEqual({ model: "claude-opus-5" });
    expect(result.current.phase).toBe("streaming");
  });

  it("accumulates the result footer facts and moves to finished on end", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);
    const { result } = renderHook(() => useAgentConsole("run-done", ref));
    act(() => {
      fakeES.emit("chunk", {
        dataB64: b64(
          JSON.stringify({ type: "system", subtype: "init", model: "m1", session_id: "s1" }) +
            "\n" +
            JSON.stringify({ type: "result", subtype: "success", num_turns: 2, total_cost_usd: 0.05 }) +
            "\n",
        ),
      });
      fakeES.emit("end", { runId: "run-done" });
    });
    expect(result.current).toEqual({
      phase: "finished",
      summary: { model: "m1", sessionId: "s1", turns: 2, costUsd: 0.05 },
    });
  });

  it("reports gone and error phases", () => {
    const ref = makeRef(vi.fn());
    const gone = renderHook(() => useAgentConsole("run-g", ref));
    act(() => {
      fakeES.emit("notfound", { runId: "run-g" });
    });
    expect(gone.result.current.phase).toBe("gone");
    fakeES = new FakeEventSource();
    const err = renderHook(() => useAgentConsole("run-e", ref));
    act(() => {
      fakeES.emit("error", { message: "boom" });
    });
    expect(err.result.current.phase).toBe("error");
  });
});
