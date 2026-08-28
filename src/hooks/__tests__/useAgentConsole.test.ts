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

  it("reassembles an NDJSON line split across two chunks", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-split", ref));

    act(() => {
      fakeES.emit("chunk", { dataB64: b64('{"type":"text","p') });
    });
    // Nothing complete yet, so nothing is written.
    expect(writeMock).not.toHaveBeenCalled();

    act(() => {
      fakeES.emit("chunk", { dataB64: b64('art":"hi"}\n') });
    });

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith('{"type":"text","part":"hi"}\r\n');
  });

  it("writes two lines when a chunk carries two NDJSON records", () => {
    const writeMock = vi.fn();
    const ref = makeRef(writeMock);

    renderHook(() => useAgentConsole("run-two", ref));

    act(() => {
      fakeES.emit("chunk", { dataB64: b64('{"a":1}\n{"b":2}\n') });
    });

    expect(writeMock).toHaveBeenCalledTimes(2);
    expect(writeMock).toHaveBeenNthCalledWith(1, '{"a":1}\r\n');
    expect(writeMock).toHaveBeenNthCalledWith(2, '{"b":2}\r\n');
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
});
