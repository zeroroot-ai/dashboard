// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * TileTerminal, the fixed-height xterm inside one Ops wall tile
 * (dashboard#1146). No toolbar, no collapse, no drag: the wall decides the
 * height and the font size from the column count and the density. Scroll
 * happens inside the tile, and xterm keeps tail-follow while the viewer
 * sits at the bottom.
 *
 * Load it with next/dynamic and { ssr: false }: xterm touches the DOM.
 */

import * as React from "react";
import { openConsoleTerminal, type ConsoleTerminal } from "@/src/lib/agent-console/terminal";
import { terminalOpenQueue } from "@/src/lib/agent-console/open-queue";
import { createBatchedWriter, type BatchedWriter } from "@/src/lib/agent-console/batched-writer";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";
import "@xterm/xterm/css/xterm.css";

interface TileTerminalProps {
  /** Accessible name of the tile terminal. */
  title: string;
  /** Fixed height in pixels, or "fill" to take the parent's height. */
  height: number | "fill";
  /** Terminal font size in pixels. */
  fontSize: number;
}

export const TileTerminal = React.forwardRef<MissionTerminalHandle, TileTerminalProps>(
  function TileTerminal({ title, height, fontSize }, ref) {
    const containerRef = React.useRef<HTMLDivElement>(null);
    const openedRef = React.useRef<ConsoleTerminal | null>(null);
    // Text joins here and reaches xterm once per frame. Before xterm opens
    // the text waits here, so a replay never touches the DOM early.
    const writerRef = React.useRef<BatchedWriter | null>(null);
    if (writerRef.current === null) {
      writerRef.current = createBatchedWriter(
        (text) => openedRef.current?.terminal.write(text),
        () => openedRef.current !== null,
      );
    }

    React.useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      let observer: ResizeObserver | null = null;
      // The open waits its turn in the shared queue, one terminal per frame.
      const cancelOpen = terminalOpenQueue.enqueue(() => {
        const opened = openConsoleTerminal(container, { fontSize, lineHeight: 1.3 });
        openedRef.current = opened;
        writerRef.current?.flush();
        observer = new ResizeObserver(() => opened.fit());
        observer.observe(container);
      });
      return () => {
        cancelOpen();
        observer?.disconnect();
        writerRef.current?.clear();
        openedRef.current?.dispose();
        openedRef.current = null;
      };
      // The terminal opens once. Font size and height changes apply below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useEffect(() => {
      const opened = openedRef.current;
      if (!opened) return;
      opened.terminal.options.fontSize = fontSize;
      opened.fit();
    }, [fontSize, height]);

    React.useImperativeHandle(ref, () => ({
      write(text: string) {
        writerRef.current?.push(text);
      },
      clear() {
        writerRef.current?.clear();
        openedRef.current?.terminal.clear();
      },
    }));

    return (
      <div
        ref={containerRef}
        role="log"
        aria-label={title}
        style={height === "fill" ? undefined : { height }}
        className={height === "fill" ? "h-full min-h-0 w-full overflow-hidden" : "w-full overflow-hidden"}
      />
    );
  },
);
