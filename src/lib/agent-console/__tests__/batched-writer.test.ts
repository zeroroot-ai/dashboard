// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Batched writer and open queue tests. They guard the wall against a main
 * thread stall: a replayed backlog must reach xterm in a few writes, and a
 * wall of terminals must open one per frame.
 */
import { describe, it, expect, vi } from "vitest";
import { createBatchedWriter, type FrameScheduler } from "../batched-writer";
import { createOpenQueue } from "../open-queue";

/** A scheduler the test steps by hand, one frame at a time. */
function manualFrames() {
  const pending: (() => void)[] = [];
  const schedule: FrameScheduler = (fn) => {
    pending.push(fn);
    return () => {
      const i = pending.indexOf(fn);
      if (i >= 0) pending.splice(i, 1);
    };
  };
  const frame = () => pending.shift()?.();
  return { schedule, frame, count: () => pending.length };
}

describe("createBatchedWriter", () => {
  it("writes a 2048 line backlog in one write, in order", () => {
    const frames = manualFrames();
    const write = vi.fn();
    const w = createBatchedWriter(write, () => true, frames.schedule);
    for (let i = 0; i < 2048; i++) w.push(`line ${i}\r\n`);
    expect(write).not.toHaveBeenCalled();
    frames.frame();
    expect(write).toHaveBeenCalledTimes(1);
    const text = write.mock.calls[0][0] as string;
    expect(text.startsWith("line 0\r\n")).toBe(true);
    expect(text.endsWith("line 2047\r\n")).toBe(true);
    expect(text.split("\r\n")).toHaveLength(2049);
  });

  it("schedules one frame for any number of pushes", () => {
    const frames = manualFrames();
    const w = createBatchedWriter(vi.fn(), () => true, frames.schedule);
    for (let i = 0; i < 100; i++) w.push("x");
    expect(frames.count()).toBe(1);
  });

  it("keeps the text while the target is not ready, then writes it on flush", () => {
    const frames = manualFrames();
    const write = vi.fn();
    let ready = false;
    const w = createBatchedWriter(write, () => ready, frames.schedule);
    w.push("a");
    w.push("b");
    frames.frame();
    expect(write).not.toHaveBeenCalled();
    ready = true;
    w.flush();
    expect(write).toHaveBeenCalledExactlyOnceWith("ab");
  });

  it("clear drops the queued text and the scheduled frame", () => {
    const frames = manualFrames();
    const write = vi.fn();
    const w = createBatchedWriter(write, () => true, frames.schedule);
    w.push("a");
    w.clear();
    expect(frames.count()).toBe(0);
    frames.frame();
    expect(write).not.toHaveBeenCalled();
  });
});

describe("createOpenQueue", () => {
  it("opens twelve terminals one per frame, in order", () => {
    const frames = manualFrames();
    const q = createOpenQueue(frames.schedule);
    const opened: number[] = [];
    for (let i = 0; i < 12; i++) q.enqueue(() => opened.push(i));
    expect(opened).toEqual([]);
    frames.frame();
    expect(opened).toEqual([0]);
    frames.frame();
    expect(opened).toEqual([0, 1]);
    while (frames.count() > 0) frames.frame();
    expect(opened).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("a cancelled task never runs", () => {
    const frames = manualFrames();
    const q = createOpenQueue(frames.schedule);
    const ran = vi.fn();
    const cancel = q.enqueue(ran);
    cancel();
    while (frames.count() > 0) frames.frame();
    expect(ran).not.toHaveBeenCalled();
  });
});
