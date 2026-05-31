"use client";

/**
 * RunsList — the landing view for /dashboard/traces (dashboard#535).
 *
 * Shows one row per mission run (traces grouped by session). Each run row
 * reads as mission activity — label, agents involved, total tokens (spend
 * proxy), status, and when — and expands to its constituent traces, each of
 * which opens the run view (#533). No raw observation jargon in the default
 * list; per-$ spend lives on the run view's Spend tab (#534).
 */

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatTokenCount } from "@/src/lib/trace-utils";
import type { TraceRun } from "@/src/lib/trace-runs";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function StatusBadge({ status }: { status: "ok" | "error" }) {
  return (
    <Badge
      variant="outline"
      className={
        status === "error"
          ? "border-destructive/50 text-destructive"
          : "border-highlight/50 text-highlight"
      }
    >
      {status === "error" ? "Error" : "OK"}
    </Badge>
  );
}

function RunRow({ run }: { run: TraceRun }) {
  // A singleton run (one trace, no session) links straight to its run view;
  // a multi-trace session expands to list its traces.
  const singleTrace = !run.isSession && run.traces.length === 1;
  const [expanded, setExpanded] = React.useState(false);

  const meta = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {run.agents.length > 0 && (
        <span className="hidden sm:inline">
          {run.agents.length} agent{run.agents.length === 1 ? "" : "s"}
        </span>
      )}
      <span className="font-mono tabular-nums" title="total tokens">
        {formatTokenCount(run.totalTokens)} tok
      </span>
      <span className="tabular-nums">{formatTimestamp(run.latestTimestamp)}</span>
      <StatusBadge status={run.status} />
    </div>
  );

  const title = (
    <div className="flex min-w-0 items-center gap-2">
      {run.status === "error" && (
        <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-hidden />
      )}
      <span className="truncate font-medium">{run.label}</span>
      {run.agents.length > 0 && (
        <span className="hidden truncate font-mono text-[10px] text-muted-foreground md:inline">
          {run.agents.join(" · ")}
        </span>
      )}
    </div>
  );

  if (singleTrace) {
    return (
      <li>
        <Link
          href={`/dashboard/traces/${run.traces[0].id}`}
          className="flex items-center justify-between gap-3 rounded-lg border border-highlight/15 bg-card/40 px-3 py-2.5 hover:border-highlight/40"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-3.5 shrink-0" aria-hidden />
            {title}
          </div>
          {meta}
        </Link>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-highlight/15 bg-card/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {title}
          <Badge
            variant="outline"
            className="shrink-0 border-border text-[10px] text-muted-foreground"
          >
            {run.traces.length} traces
          </Badge>
        </div>
        {meta}
      </button>

      {expanded && (
        <ul className="border-t border-highlight/10 px-3 py-1.5">
          {run.traces.map((trace) => (
            <li key={trace.id}>
              <Link
                href={`/dashboard/traces/${trace.id}`}
                className="flex items-center justify-between gap-3 py-1.5 pl-6 text-xs hover:underline"
              >
                <span className="truncate text-link">{trace.name || trace.id}</span>
                <span className="flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
                  {formatTokenCount(trace.totalTokens)} tok
                  <span>{formatTimestamp(trace.timestamp)}</span>
                  <StatusBadge status={trace.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function RunsList({ runs }: { runs: TraceRun[] }) {
  return (
    <ul className={cn("space-y-2")}>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}
