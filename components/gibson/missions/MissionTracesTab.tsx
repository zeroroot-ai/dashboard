"use client";

import * as React from "react";
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CpuIcon,
  GitBranchIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { useMissionTrace } from "@/src/hooks/useTraces";
import type { MissionStatus } from "@/src/types";
import type { TraceNode, TraceNodeType } from "@/src/types/trace";

interface MissionTracesTabProps {
  missionId: string;
  missionStatus?: MissionStatus;
}

const TYPE_ICONS: Record<TraceNodeType, React.ComponentType<{ className?: string }>> = {
  mission: ActivityIcon,
  decision: GitBranchIcon,
  agent: CpuIcon,
  tool: WrenchIcon,
  generation: SparklesIcon,
  span: ChevronRightIcon,
};

const TYPE_LABELS: Record<TraceNodeType, string> = {
  mission: "Mission",
  decision: "Decision",
  agent: "Agent",
  tool: "Tool",
  generation: "LLM",
  span: "Span",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${mins}m ${seconds}s`;
}

function TraceTreeRow({ node, depth }: { node: TraceNode; depth: number }) {
  const Icon = TYPE_ICONS[node.type] ?? ChevronRightIcon;
  const isError = node.status === "error";

  return (
    <>
      <div
        className="flex items-start gap-3 py-2 border-b border-highlight/15 last:border-b-0"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        <Icon
          className={
            isError
              ? "size-4 shrink-0 mt-0.5 text-destructive"
              : "size-4 shrink-0 mt-0.5 text-highlight"
          }
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-foreground text-sm font-medium font-mono break-all">
              {node.name}
            </span>
            <Badge
              variant="outline"
              className="text-[10px] font-mono uppercase tracking-wide border-border text-muted-foreground"
            >
              {TYPE_LABELS[node.type] ?? node.type}
            </Badge>
            {node.model && (
              <span className="text-muted-foreground text-xs font-mono">{node.model}</span>
            )}
          </div>
          {isError && node.errorMessage && (
            <p className="text-destructive text-xs mt-1 font-mono">{node.errorMessage}</p>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-xs font-mono tabular-nums">
          {node.tokens && (node.tokens.input > 0 || node.tokens.output > 0) && (
            <span className="text-muted-foreground">
              <span className="text-highlight">{node.tokens.input}</span>
              /
              <span className="text-highlight">{node.tokens.output}</span>
            </span>
          )}
          <span className="text-muted-foreground">{formatDuration(node.durationMs)}</span>
          {isError ? (
            <AlertTriangleIcon className="size-3.5 text-destructive" aria-label="error" />
          ) : (
            <CheckCircle2Icon className="size-3.5 text-highlight" aria-label="ok" />
          )}
        </div>
      </div>
      {node.children.map((child) => (
        <TraceTreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

/**
 * MissionTracesTab renders the trace tree for one mission.
 *
 * Data source: the existing /api/missions/[id]/traces route via the
 * existing useMissionTrace hook. The route resolves the mission's
 * trace_id from history, fetches the trace tree, returns the canonical
 * TraceData shape. This tab renders an indented list of nodes
 * (mission / decision / agent / tool / LLM / span) with type, name,
 * status, token counts (input/output), and duration. A rich
 * timeline-style visualization is post-MVP.
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
      <div className="glass-hack rounded-lg p-3">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
            <span className="text-muted-foreground">
              Total{" "}
              <span className="text-highlight font-medium">
                {formatDuration(data.totalDurationMs)}
              </span>
            </span>
            <span className="text-muted-foreground">
              LLM calls{" "}
              <span className="text-highlight font-medium">
                {data.tokenSummary.llmCallCount}
              </span>
            </span>
            <span className="text-muted-foreground">
              Tokens{" "}
              <span className="text-highlight font-medium">
                {data.tokenSummary.totalTokens.toLocaleString()}
              </span>
            </span>
          </div>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground pb-2 border-b border-highlight/30 flex justify-between">
          <span>Trace</span>
          <span>input/output · duration</span>
        </div>
        <div>
          {data.traceTree.map((node) => (
            <TraceTreeRow key={node.id} node={node} depth={0} />
          ))}
        </div>
      </div>
    </div>
  );
}
