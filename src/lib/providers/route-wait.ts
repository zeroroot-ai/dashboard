// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Wait for the route of a saved provider (gibson#1394).
 *
 * After a save, the tenant operator pulls the provider record, about every 30
 * seconds, and makes the route on the model gateway. Until then the daemon
 * answers "route not ready". The caller polls until the answer is anything
 * else, or until the time runs out. The function takes its clock and its
 * sleep, so a test needs no real time.
 */

export type RouteWaitOutcome<T> =
  | { state: "ready"; result: T; attempts: number }
  | { state: "timeout"; attempts: number }
  | { state: "aborted"; attempts: number }
  | { state: "error"; error: unknown; attempts: number };

interface RouteWaitOptions<T> {
  /** One check. routeNotReady true means keep waiting. */
  poll: () => Promise<{ routeNotReady: boolean; result: T }>;
  intervalMs: number;
  timeoutMs: number;
  /** Called before each wait, so the page can show the progress. */
  onWaiting?: (info: { attempts: number; elapsedMs: number }) => void;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export async function waitForRoute<T>(opts: RouteWaitOptions<T>): Promise<RouteWaitOutcome<T>> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const start = now();
  let attempts = 0;
  for (;;) {
    if (opts.signal?.aborted) return { state: "aborted", attempts };
    attempts++;
    let step: { routeNotReady: boolean; result: T };
    try {
      step = await opts.poll();
    } catch (error) {
      return { state: "error", error, attempts };
    }
    if (opts.signal?.aborted) return { state: "aborted", attempts };
    if (!step.routeNotReady) return { state: "ready", result: step.result, attempts };
    const elapsedMs = now() - start;
    if (elapsedMs + opts.intervalMs > opts.timeoutMs) return { state: "timeout", attempts };
    opts.onWaiting?.({ attempts, elapsedMs });
    await sleep(opts.intervalMs, opts.signal);
  }
}
