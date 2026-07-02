"use client";

/**
 * RunsList, the landing view for /dashboard/traces (gibson#755).
 *
 * One row per run: the LLM calls a single AgentRun drove, labelled by run id
 * (or "Ungrouped calls" for mission/chat-level calls). Each row reads as model
 * activity — models used, call count, total tokens (spend proxy) — and links to
 * the run view, where each call expands into its full prompt ↔ response detail.
 */

import Link from "next/link";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatTokenCount, formatUsd } from "@/src/lib/world-traces";
import type { LlmRun } from "@/src/types/trace";

/** The empty (ungrouped) run id routes to the URL-safe "_" segment. */
function runHref(run: LlmRun): string {
  return `/dashboard/traces/${run.id === "" ? "_" : encodeURIComponent(run.id)}`;
}

function RunRow({ run }: { run: LlmRun }) {
  const meta = (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline tabular-nums">
        {run.callCount} call{run.callCount === 1 ? "" : "s"}
      </span>
      <span className="font-mono tabular-nums" title="total tokens">
        {formatTokenCount(run.totalTokens)} tok
      </span>
      {run.estimatedCostUsd > 0 && (
        <span className="font-mono tabular-nums" title="estimated cost">
          {formatUsd(run.estimatedCostUsd)}
        </span>
      )}
    </div>
  );

  return (
    <li>
      <Link
        href={runHref(run)}
        className="flex items-center justify-between gap-3 rounded-lg border border-highlight/15 bg-card/40 px-3 py-2.5 hover:border-highlight/40"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{run.label}</span>
          {run.models.length > 0 && (
            <Badge
              variant="outline"
              className="shrink-0 border-border font-mono text-[10px] text-muted-foreground"
            >
              {run.models.length === 1 ? run.models[0] : `${run.models.length} models`}
            </Badge>
          )}
        </div>
        {meta}
      </Link>
    </li>
  );
}

export function RunsList({ runs }: { runs: LlmRun[] }) {
  return (
    <ul className={cn("space-y-2")}>
      {runs.map((run) => (
        <RunRow key={run.id} run={run} />
      ))}
    </ul>
  );
}
