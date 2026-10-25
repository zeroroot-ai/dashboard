// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * TileTerminal tests. A replayed backlog of 2048 lines must reach xterm in a
 * few writes, and a tile opens its terminal on a later frame, not in the
 * commit that mounts it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import * as React from "react";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";

const write = vi.fn();
const openConsoleTerminal = vi.fn(() => ({
  terminal: { write, clear: vi.fn(), options: {} },
  fit: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("@/src/lib/agent-console/terminal", () => ({
  openConsoleTerminal: (...args: unknown[]) => (openConsoleTerminal as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { TileTerminal } from "../TileTerminal";

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.useFakeTimers();
  write.mockClear();
  openConsoleTerminal.mockClear();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TileTerminal", () => {
  it("writes a 2048 line backlog to xterm in at most two writes", () => {
    const ref = React.createRef<MissionTerminalHandle>();
    render(<TileTerminal ref={ref} title="t" height={200} fontSize={12} />);
    // The backlog arrives before xterm opens, as it does on a new tile.
    for (let i = 0; i < 1024; i++) ref.current?.write(`line ${i}\r\n`);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(openConsoleTerminal).toHaveBeenCalledTimes(1);
    for (let i = 1024; i < 2048; i++) ref.current?.write(`line ${i}\r\n`);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(write.mock.calls.length).toBeLessThanOrEqual(2);
    const all = write.mock.calls.map((c) => c[0] as string).join("");
    expect(all.split("\r\n")).toHaveLength(2049);
    expect(all.startsWith("line 0\r\n")).toBe(true);
    expect(all.endsWith("line 2047\r\n")).toBe(true);
  });

  it("does not open xterm in the commit that mounts the tile", () => {
    render(<TileTerminal title="t" height={200} fontSize={12} />);
    expect(openConsoleTerminal).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(openConsoleTerminal).toHaveBeenCalledTimes(1);
  });
});
