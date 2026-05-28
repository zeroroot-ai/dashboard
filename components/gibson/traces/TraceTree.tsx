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

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useObservationDetail } from "@/src/hooks/useTraces";
import type { TraceNode, TraceNodeType } from "@/src/types/trace";
import { ConversationView } from "./ConversationView";

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

/** Node types whose full prompt ↔ response conversation can be drilled into. */
function isExpandable(type: TraceNodeType): boolean {
  return type === "decision" || type === "generation";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${mins}m ${seconds}s`;
}

/**
 * Shared presentational header for a trace row — type icon, name, type badge,
 * model, token counts, duration, and status. Used identically by the static
 * row and the expandable decision row so the two never visually diverge.
 */
function RowHeaderBody({ node }: { node: TraceNode }) {
  const Icon = TYPE_ICONS[node.type] ?? ChevronRightIcon;
  const isError = node.status === "error";

  return (
    <>
      <Icon
        className={cn(
          "size-4 shrink-0 mt-0.5",
          isError ? "text-destructive" : "text-highlight",
        )}
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
    </>
  );
}

const ROW_CLASSES =
  "flex items-start gap-3 py-2 border-b border-highlight/15 last:border-b-0";

/** Non-expandable node (mission / agent / tool / span). */
function StaticTraceRow({ node, depth }: { node: TraceNode; depth: number }) {
  return (
    <div className={ROW_CLASSES} style={{ paddingLeft: `${depth * 1.25}rem` }}>
      {/* Spacer matching the chevron width so static and expandable rows align. */}
      <span className="size-3.5 shrink-0" aria-hidden="true" />
      <RowHeaderBody node={node} />
    </div>
  );
}

/**
 * Expandable LLM / decision node. Clicking the header lazily loads the
 * observation's conversation via useObservationDetail and renders it with
 * ConversationView. The fetch is gated on `open` so collapsed rows cost
 * nothing.
 */
function TraceDecisionRow({
  node,
  depth,
}: {
  node: TraceNode;
  depth: number;
}) {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading, isError } = useObservationDetail(node.id, open);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(ROW_CLASSES, "w-full text-left hover:bg-muted/30")}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        <ChevronRightIcon
          className={cn(
            "size-3.5 shrink-0 mt-0.5 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
        <RowHeaderBody node={node} />
      </button>

      {open && (
        <div
          className="py-3 border-b border-highlight/15"
          style={{ paddingLeft: `${(depth + 1) * 1.25}rem` }}
        >
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          ) : isError ? (
            <p className="font-mono text-xs text-destructive">
              Could not load this call&apos;s conversation. Try again shortly.
            </p>
          ) : data ? (
            data.contentAvailable ? (
              <ConversationView
                messages={data.messages}
                tokens={{
                  input: data.metadata.inputTokens,
                  output: data.metadata.outputTokens,
                }}
              />
            ) : (
              <p className="font-mono text-xs text-muted-foreground">
                No conversation content was recorded for this call (content
                logging is disabled).
              </p>
            )
          ) : null}
        </div>
      )}
    </>
  );
}

/** Recursive walker — one renderer for the whole tree, no parallel path. */
function TraceTreeRow({ node, depth }: { node: TraceNode; depth: number }) {
  return (
    <>
      {isExpandable(node.type) ? (
        <TraceDecisionRow node={node} depth={depth} />
      ) : (
        <StaticTraceRow node={node} depth={depth} />
      )}
      {node.children.map((child) => (
        <TraceTreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export interface TraceTreeProps {
  nodes: TraceNode[];
}

/**
 * Renders a trace tree as an indented list. LLM/decision nodes are expandable
 * into their full prompt ↔ response conversation; all other node types render
 * as static rows. Shared by the mission Traces tab and the standalone trace
 * detail page.
 */
export function TraceTree({ nodes }: TraceTreeProps) {
  return (
    <div>
      {nodes.map((node) => (
        <TraceTreeRow key={node.id} node={node} depth={0} />
      ))}
    </div>
  );
}
