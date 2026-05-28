"use client";

/**
 * TraceDetailView — client component backing /dashboard/traces/[id].
 *
 * Fetches a trace directly by id via useTraceDetail and renders it with the
 * SAME shared components as the mission Traces tab: TokenSummaryPanel above
 * the expandable TraceTree. There is one trace renderer — this page composes
 * it, it does not reimplement it.
 */

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { ActivityIcon } from "lucide-react";
import { TokenSummaryPanel } from "@/components/gibson/traces/TokenSummaryPanel";
import { TraceTree } from "@/components/gibson/traces/TraceTree";
import { useTraceDetail } from "@/src/hooks/useTraces";

export function TraceDetailView({ traceId }: { traceId: string }) {
  const { data, isLoading, isError, error, refetch } = useTraceDetail(traceId);

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
    // 404 "not available" is a normal state — render an empty state, not an error.
    if (msg.includes("not available")) {
      return (
        <div className="space-y-4">
          {backLink}
          <EmptyState
            icon={ActivityIcon}
            title="Trace not found"
            description="This trace is no longer available, or it predates trace recording."
          />
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {backLink}
        <ErrorAlert
          error={error instanceof Error ? error : { message: String(error) }}
          title="Failed to load trace"
          retry={() => refetch()}
        />
      </div>
    );
  }

  if (!data || data.traceTree.length === 0) {
    return (
      <div className="space-y-4">
        {backLink}
        <EmptyState
          icon={ActivityIcon}
          title="No trace content"
          description="This trace recorded no LLM activity."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {backLink}
      <div>
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
          Trace
        </h1>
        <p className="text-xs text-muted-foreground font-mono">{data.traceId}</p>
      </div>

      <TokenSummaryPanel
        summary={data.tokenSummary}
        totalDurationMs={data.totalDurationMs}
      />
      <div className="glass-hack rounded-lg p-3">
        <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground pb-2 border-b border-highlight/30 flex justify-between">
          <span>Trace</span>
          <span>input/output · duration</span>
        </div>
        <TraceTree nodes={data.traceTree} />
      </div>
    </div>
  );
}
