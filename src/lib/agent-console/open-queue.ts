// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Opens terminals one per animation frame.
 *
 * Opening an xterm measures the font, and that read forces a layout of the
 * whole page. A wall that opens twelve terminals in one commit blocks the
 * main thread for the sum of the twelve. This queue runs one open per frame,
 * so no single task grows with the number of tiles and the page keeps
 * answering input while the wall fills.
 */

import { scheduleFrame, type FrameScheduler } from "@/src/lib/agent-console/batched-writer";

interface OpenQueue {
  /** Runs `task` on a later frame, after the tasks queued before it. */
  enqueue: (task: () => void) => () => void;
}

export function createOpenQueue(schedule: FrameScheduler = scheduleFrame): OpenQueue {
  const tasks: (() => void)[] = [];
  let cancel: (() => void) | null = null;

  const run = (): void => {
    cancel = null;
    const task = tasks.shift();
    try {
      if (task) task();
    } finally {
      // A task that throws must not starve the tasks behind it.
      if (tasks.length > 0) cancel = schedule(run);
    }
  };

  return {
    enqueue(task) {
      tasks.push(task);
      if (cancel === null) cancel = schedule(run);
      return () => {
        const i = tasks.indexOf(task);
        if (i >= 0) tasks.splice(i, 1);
      };
    },
  };
}

/** The queue every wall tile shares. */
export const terminalOpenQueue: OpenQueue = createOpenQueue();
