// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * Small clocks for the Ops wall. Each owns its one-second timer and renders
 * one span, so a tick re-renders that span and nothing else. A tile that
 * kept the timer itself re-rendered its header, its terminal wrapper and
 * its job panel every second, twelve times over on a full wall.
 */

import * as React from "react";
import { formatDuration } from "@/src/lib/agent-console/stream-json";

/** The current time, updated every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Time since `startedAt`, ticking while the run streams and frozen once it
 * stops. Renders nothing for a bad start time.
 */
export function Elapsed({
  startedAt,
  running,
  className,
}: {
  startedAt: string;
  running: boolean;
  className?: string;
}) {
  const start = new Date(startedAt).getTime();
  const now = useNow(running && !isNaN(start));
  if (isNaN(start)) return null;
  return (
    <span className={className} title="elapsed">
      {formatDuration(Math.max(0, now - start))}
    </span>
  );
}

/** "3m 05s ago" for an ISO time, "never" for none, "unknown" for a bad one. */
export function Ago({ iso, className }: { iso: string | null; className?: string }) {
  const t = iso ? new Date(iso).getTime() : NaN;
  const now = useNow(iso !== null && !isNaN(t));
  let text: string;
  if (!iso) text = "never";
  else if (isNaN(t)) text = "unknown";
  else text = `${formatDuration(Math.max(0, now - t))} ago`;
  return (
    <span className={className} title="last input">
      {text}
    </span>
  );
}
