/**
 * Unit tests for the `useTenantAvailability` debounced hook (dashboard#44).
 *
 * Uses a 5ms debounce window so tests run in real time without the fake-
 * timers + promise-microtask + waitFor interaction that breaks vitest's
 * vi.useFakeTimers in async tests. The hook's behaviour is the same at
 * 5ms as it is at 400ms; the only thing the debounce changes is the
 * cadence, not the state-machine.
 *
 * Covers:
 *   1. Empty / too-short input → `available: null`, no fetch fires.
 *   2. Settled input → one fetch fires after debounce, state reflects the
 *      server's answer (free vs taken vs degraded).
 *   3. Rapid keystrokes → fetches for stale inputs are cancelled (via
 *      AbortController + the latest-request-id guard) and their results
 *      don't overwrite a fresher answer.
 *   4. Network failure → state degrades to `null` (no inline signal,
 *      server-side check is authoritative).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { useTenantAvailability } from "../use-tenant-availability";

// Use unknown as the spy's first arg so .mock.calls[0][0] is callable; the
// real fetch signature is (input, init?) and tests only ever inspect input.
function mockFetchOnce(body: unknown) {
  const fetchSpy = vi.fn(async (_input: unknown) => ({
    ok: true,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function mockFetchWith(impl: (url: string) => unknown) {
  const fetchSpy = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String(input);
    return {
      ok: true,
      json: async () => impl(url),
    };
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useTenantAvailability", () => {
  it("empty input → available: null, no fetch", async () => {
    const fetchSpy = mockFetchOnce({ available: true });
    const { result } = renderHook(() => useTenantAvailability("", { debounceMs: 5 }));

    // Give the effect a tick to do nothing.
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.available).toBeNull();
    expect(result.current.checking).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("single-character input → available: null, no fetch (too short)", async () => {
    const fetchSpy = mockFetchOnce({ available: true });
    const { result } = renderHook(() => useTenantAvailability("a", { debounceMs: 5 }));

    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.available).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("settled input → one fetch after debounce, state reflects server answer (free)", async () => {
    const fetchSpy = mockFetchOnce({ slug: "acme-security", available: true });
    const { result } = renderHook(() =>
      useTenantAvailability("Acme Security", { debounceMs: 5 }),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.available).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      "/api/auth/tenant-available?name=Acme%20Security",
    );
  });

  it("server says 'taken' → hook state is false", async () => {
    mockFetchOnce({ slug: "acme-security", available: false });
    const { result } = renderHook(() =>
      useTenantAvailability("Acme Security", { debounceMs: 5 }),
    );

    await waitFor(() => {
      expect(result.current.available).toBe(false);
    });
    expect(result.current.checking).toBe(false);
  });

  it("server says 'degraded' (available: null) → hook state is null", async () => {
    mockFetchOnce({ slug: "acme-security", available: null, reason: "lookup_failed" });
    const { result } = renderHook(() =>
      useTenantAvailability("Acme Security", { debounceMs: 5 }),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.available).toBeNull();
  });

  it("rapid keystrokes → only the LAST input's fetch result reaches state", async () => {
    // Each fetch resolves with `{ available: false }` keyed on the slug so
    // we can confirm which input's answer "wins". The fetch returns
    // immediately; the latest-request-id guard + AbortController handle
    // de-duplication.
    const fetchSpy = mockFetchWith((url) => {
      const slug = new URL(url, "http://test").searchParams.get("name");
      return { slug, available: false };
    });

    const { result, rerender } = renderHook(
      ({ name }) => useTenantAvailability(name, { debounceMs: 5 }),
      { initialProps: { name: "ac" } },
    );

    // Re-render with longer inputs in quick succession. Each call clears
    // the previous timer (via the effect cleanup) and aborts the
    // previous controller (via abortRef).
    rerender({ name: "acm" });
    rerender({ name: "acme" });
    rerender({ name: "acme corp" });

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });

    // Only one fetch should have actually fired (the others were
    // cancelled mid-debounce by the effect cleanup).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain(
      encodeURIComponent("acme corp"),
    );
  });

  it("network failure → state degrades to available: null (no inline signal)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { result } = renderHook(() =>
      useTenantAvailability("Acme Security", { debounceMs: 5 }),
    );

    await waitFor(() => {
      expect(result.current.checking).toBe(false);
    });
    expect(result.current.available).toBeNull();
  });
});
