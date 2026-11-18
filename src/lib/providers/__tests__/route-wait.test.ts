// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from "vitest";

import { waitForRoute } from "../route-wait";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("waitForRoute", () => {
  it("returns at once when the route is ready", async () => {
    const c = clock();
    const poll = vi.fn().mockResolvedValue({ routeNotReady: false, result: "ok" });
    const out = await waitForRoute({ poll, intervalMs: 5000, timeoutMs: 60000, ...c });
    expect(out).toEqual({ state: "ready", result: "ok", attempts: 1 });
  });

  it("polls until the route is ready", async () => {
    const c = clock();
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ routeNotReady: true, result: "a" })
      .mockResolvedValueOnce({ routeNotReady: true, result: "b" })
      .mockResolvedValueOnce({ routeNotReady: false, result: "c" });
    const seen: number[] = [];
    const out = await waitForRoute({
      poll,
      intervalMs: 5000,
      timeoutMs: 60000,
      onWaiting: (i) => seen.push(i.elapsedMs),
      ...c,
    });
    expect(out).toEqual({ state: "ready", result: "c", attempts: 3 });
    expect(seen).toEqual([0, 5000]);
  });

  it("times out when the route never comes, and stops polling", async () => {
    const c = clock();
    const poll = vi.fn().mockResolvedValue({ routeNotReady: true, result: null });
    const out = await waitForRoute({ poll, intervalMs: 5000, timeoutMs: 20000, ...c });
    expect(out.state).toBe("timeout");
    // Checks at 0, 5000, 10000, 15000 and 20000 ms.
    expect(poll).toHaveBeenCalledTimes(5);
    expect(c.now()).toBeLessThanOrEqual(20000);
  });

  it("stops when the signal aborts", async () => {
    const c = clock();
    const ctl = new AbortController();
    const poll = vi.fn().mockImplementation(async () => {
      ctl.abort();
      return { routeNotReady: true, result: null };
    });
    const out = await waitForRoute({ poll, intervalMs: 5000, timeoutMs: 60000, signal: ctl.signal, ...c });
    expect(out.state).toBe("aborted");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("returns an error when a check throws, and does not retry", async () => {
    const c = clock();
    const boom = new Error("network");
    const poll = vi.fn().mockRejectedValue(boom);
    const out = await waitForRoute({ poll, intervalMs: 5000, timeoutMs: 60000, ...c });
    expect(out).toEqual({ state: "error", error: boom, attempts: 1 });
  });
});
