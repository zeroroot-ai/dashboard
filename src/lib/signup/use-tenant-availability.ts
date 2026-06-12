"use client";

import { useEffect, useRef, useState } from "react";

import { slugify } from "./slug";

/** Debounce window applied to per-keystroke lookups. */
const DEFAULT_DEBOUNCE_MS = 400;

/** Minimum slug length we'll bother checking server-side. */
const MIN_SLUG_LENGTH = 2;

export interface TenantAvailability {
  /** Slugified form of the user's input. Empty when input slugifies to empty. */
  slug: string;
  /**
   * Null while the input is too short, while we're debouncing, while a
   * lookup is in flight, or when the server signalled a degraded answer
   * (which the UI should treat as "no inline signal"). True = free; false = taken.
   */
  available: boolean | null;
  /** True while the debounce timer + fetch are in flight. */
  checking: boolean;
}

interface ApiResponse {
  slug: string;
  available: boolean | null;
  reason?: "empty" | "lookup_failed";
}

/**
 * Debounced "is this workspace slug already a Tenant?" lookup.
 *
 * Fires GET /api/auth/tenant-available?name=<rawName>. Each new `rawName`
 * starts a fresh debounce window; the previous window's in-flight fetch
 * (if any) is cancelled via AbortController so its result can't overwrite
 * a fresher answer.
 *
 * The hook never blocks rendering and is safe to read every render: the
 * caller flips state based on `available` (`false` = render the inline
 * "name is taken" message and disable submit) and on `checking` (e.g. a
 * spinner). When `available` is `null`, render no inline state and let
 * the form's existing client-side checks handle the case.
 *
 * Spec / issue: zeroroot-ai/dashboard#44.
 *
 * @param rawName  the user's input value (un-slugified).
 * @param opts.debounceMs  override the 400ms default; mainly for tests.
 */
export function useTenantAvailability(
  rawName: string,
  opts: { debounceMs?: number } = {},
): TenantAvailability {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const slug = slugify(rawName || "");
  const [state, setState] = useState<TenantAvailability>({
    slug,
    available: null,
    checking: false,
  });

  // Track the most-recent in-flight request so its result is the one that
  // ends up in state (a stale resolve from a previous keystroke must not
  // overwrite the answer for the current input).
  const latestRequestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Empty / too-short slugs: clear state immediately, no fetch.
    if (!slug || slug.length < MIN_SLUG_LENGTH) {
      setState({ slug, available: null, checking: false });
      return;
    }

    setState((prev) => ({ slug, available: prev.slug === slug ? prev.available : null, checking: true }));

    const requestId = ++latestRequestIdRef.current;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      void fetch(
        `/api/auth/tenant-available?name=${encodeURIComponent(rawName)}`,
        { signal: controller.signal },
      )
        .then((r) => (r.ok ? (r.json() as Promise<ApiResponse>) : null))
        .then((data) => {
          if (requestId !== latestRequestIdRef.current) return; // stale
          if (!data) {
            setState({ slug, available: null, checking: false });
            return;
          }
          setState({ slug, available: data.available, checking: false });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (requestId !== latestRequestIdRef.current) return;
          // Network failure: treat the same as the server's `lookup_failed`
          // degradation, no inline state, let the submit-time check run.
          setState({ slug, available: null, checking: false });
          // Surface the failure once per debounce window in dev so we can
          // spot a misconfigured route quickly.
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[tenant-availability] fetch failed", err);
          }
        });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [rawName, slug, debounceMs]);

  return state;
}
