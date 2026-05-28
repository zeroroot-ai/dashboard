"use client";

import { ActivityIcon } from "lucide-react";

import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { TraceTree } from "@/components/gibson/traces/TraceTree";
import { TokenSummaryPanel } from "@/components/gibson/traces/TokenSummaryPanel";
import { useMissionTrace } from "@/src/hooks/useTraces";
import type { MissionStatus } from "@/src/types";

interface MissionTracesTabProps {
  missionId: string;
  missionStatus?: MissionStatus;
}

/**
 * MissionTracesTab renders the trace tree for one mission.
 *
 * Data source: the existing /api/missions/[id]/traces route via the
 * existing useMissionTrace hook. The route resolves the mission's
 * trace_id from history, fetches the trace tree, returns the canonical
 * TraceData shape. Rendering is delegated to the shared <TraceTree>:
 * mission / agent / tool / span nodes render as static rows, while LLM
 * and decision nodes are expandable into their full prompt ↔ response
 * conversation. The same <TraceTree> backs the standalone trace detail
 * page (dashboard#470) — there is one trace renderer.
 *
 * The underlying hook auto-refetches every 10s when the mission is
 * running or paused; completed missions are cached for 60s.
 */
export function MissionTracesTab({ missionId, missionStatus }: MissionTracesTabProps) {
  const { data, isLoading, isError, error, refetch } = useMissionTrace(missionId, missionStatus);

  if (isLoading) {
    return <TableSkeleton rows={6} cols={1} />;
  }

  if (isError) {
    const msg = error instanceof Error ? error.message : String(error);
    // 404 / "not available" is a normal state for missions that predate
    // trace recording or never produced any LLM activity. Render an empty
    // state rather than an error alert.
    if (msg.includes("not available")) {
      return (
        <EmptyState
          icon={ActivityIcon}
          title="No traces for this mission"
          description="Traces capture each LLM call and tool invocation the agent makes. This mission either predates trace recording or did not invoke an LLM."
        />
      );
    }
    return (
      <ErrorAlert
        error={error instanceof Error ? error : { message: String(error) }}
        title="Failed to load traces"
        retry={() => refetch()}
      />
    );
  }

  if (!data || data.traceTree.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        title="No traces yet"
        description="Traces appear here as the mission's agents make LLM calls and invoke tools. If the mission is still running, refresh shortly."
      />
    );
  }

  return (
    <div className="space-y-3">
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
