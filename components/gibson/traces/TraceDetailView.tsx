"use client";

/**
 * TraceDetailView, client component backing /dashboard/traces/[id].
 *
 * `id` is a run id (the URL-safe "_" segment is the empty/ungrouped run). It
 * fetches the run via useRunDetail and renders it through the shared RunView:
 * by-model totals, the run's LLM calls, and each call's transcript (gibson#755).
 */

import Link from "next/link";
import { ArrowLeft, ActivityIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { RunView } from "@/components/gibson/traces/RunView";
import { useRunDetail } from "@/src/hooks/useTraces";

export function TraceDetailView({ traceId }: { traceId: string }) {
  // The list routes the empty (ungrouped) run id to the "_" segment.
  const runId = traceId === "_" ? "" : traceId;
  const { data, isLoading, isError, error, refetch } = useRunDetail(runId);

  const backLink = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        asChild
        className="gap-1.5 text-muted-foreground"
      >
        <Link href="/dashboard/traces">
          <ArrowLeft className="size-3.5" />
          Traces
        </Link>
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {backLink}
        <TableSkeleton rows={6} cols={1} />
      </div>
    );
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("not available")) {
      return (
        <div className="space-y-4">
          {backLink}
          <EmptyState
            icon={ActivityIcon}
            title="Run not found"
            description="This run has no recorded LLM calls, or it predates call recording."
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorAlert
          error={error instanceof Error ? error : { message: String(error) }}
          title="Failed to load run"
          retry={() => refetch()}
        />
      </div>
    );
  }

  if (!data || data.run.calls.length === 0) {
    return (
      <div className="space-y-4">
        {backLink}
        <EmptyState
          icon={ActivityIcon}
          title="No call activity"
          description="This run recorded no LLM calls."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {backLink}
      <div>
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">
          {data.run.label}
        </h1>
        <p className="font-mono text-[10px] text-muted-foreground/70">
          {data.run.callCount} call{data.run.callCount === 1 ? "" : "s"}
        </p>
      </div>

      <RunView run={data.run} tokenSummary={data.tokenSummary} />
    </div>
  );
}
