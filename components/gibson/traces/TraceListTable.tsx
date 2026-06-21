"use client";

/**
 * TraceListTable, client component backing /dashboard/traces.
 *
 * Lists every Gibson Trace for the tenant — the LLM-call log folded into the
 * brain World (gibson#755), grouped into runs by the AgentRun that issued the
 * calls. A free-text filter narrows by run id or model client-side; the World
 * call log carries no timestamps or tags, so there is no date/tag filter.
 */

import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorAlert } from "@/components/gibson/shared";
import { RunsList } from "@/components/gibson/traces/RunsList";
import { useRuns } from "@/src/hooks/useTraces";

export function TraceListTable() {
  const { data: runs, isLoading, isError, error } = useRuns();
  const [filter, setFilter] = React.useState("");

  const visible = React.useMemo(() => {
    const all = runs ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (run) =>
        run.label.toLowerCase().includes(q) ||
        run.models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [runs, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gibson Traces</CardTitle>
        <CardDescription>
          Every LLM call across your missions, grouped into runs, with token
          usage, model activity, and the full prompt/response detail for each
          call.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs space-y-1.5">
          <Label htmlFor="filter">Filter</Label>
          <Input
            id="filter"
            type="search"
            placeholder="Filter by run or model"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : isError ? (
          <ErrorAlert
            error={error instanceof Error ? error : { message: "Failed to load traces" }}
          />
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {runs && runs.length > 0
              ? "No runs match the filter."
              : "No LLM calls have been recorded yet. Runs appear here as your agents and chat make model calls."}
          </p>
        ) : (
          <RunsList runs={visible} />
        )}
      </CardContent>
    </Card>
  );
}
