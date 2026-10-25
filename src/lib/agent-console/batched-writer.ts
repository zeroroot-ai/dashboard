// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Batches terminal writes into one write per animation frame.
 *
 * A run that joins a surface replays its buffer, up to thousands of lines,
 * and the browser delivers a stream backlog in bursts. A write per line makes
 * xterm queue and parse thousands of tiny writes. This writer joins the text
 * that arrives between two frames and writes it once. The order of the text
 * does not change.
 */

/** Runs `fn` on the next frame and returns a function that cancels it. */
export type FrameScheduler = (fn: () => void) => () => void;

/** Uses requestAnimationFrame, or a 16 ms timer where it does not exist. */
export const scheduleFrame: FrameScheduler = (fn) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
};

export interface BatchedWriter {
  /** Queues text for the next frame. */
  push: (text: string) => void;
  /** Writes the queued text now. */
  flush: () => void;
  /** Drops the queued text and any scheduled frame. */
  clear: () => void;
}

/**
 * `write` receives the joined text. `ready` tells whether the target can take
 * a write now. While it is false the text stays queued and the writer tries
 * again after the next `push` or `flush`.
 */
export function createBatchedWriter(
  write: (text: string) => void,
  ready: () => boolean = () => true,
  schedule: FrameScheduler = scheduleFrame,
): BatchedWriter {
  let queue: string[] = [];
  let cancel: (() => void) | null = null;

  const flush = (): void => {
    cancel?.();
    cancel = null;
    if (queue.length === 0 || !ready()) return;
    const text = queue.length === 1 ? queue[0] : queue.join("");
    queue = [];
    write(text);
  };

  return {
    push(text) {
      queue.push(text);
      if (cancel === null) cancel = schedule(flush);
    },
    flush,
    clear() {
      cancel?.();
      cancel = null;
      queue = [];
    },
  };
}
