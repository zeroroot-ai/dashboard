"use client";

/**
 * MissionNodeBox — the custom React Flow node for a mission box. Styled by node
 * kind and overlaid with run state. Spec: dashboard#655 / #657.
 */

import * as React from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

import { cn } from "@/lib/utils";
import type { NodeRunState } from "./overlay";

export interface MissionNodeBoxData {
  label: string;
  kind: string;
  summary: string;
  isEntry: boolean;
  isExit: boolean;
  runState: NodeRunState;
  [key: string]: unknown;
}

type MissionNode = Node<MissionNodeBoxData, "mission">;

const KIND_LABEL: Record<string, string> = {
  agent: "Agent",
  tool: "Tool",
  plugin: "Plugin",
  condition: "Condition",
  parallel: "Parallel",
  join: "Join",
  unknown: "Node",
};

// Accent border per kind so boxes are distinguishable at a glance. Tokens only
// (no hardcoded palette utilities — enforced by check-no-hardcoded-colors).
const KIND_ACCENT: Record<string, string> = {
  agent: "border-l-primary",
  tool: "border-l-link",
  plugin: "border-l-highlight",
  condition: "border-l-alt",
  parallel: "border-l-secondary",
  join: "border-l-secondary",
  unknown: "border-l-border",
};

// Run-state ring overlaid on the box.
const STATE_RING: Record<NodeRunState, string> = {
  pending: "ring-1 ring-border",
  running: "ring-2 ring-primary animate-pulse",
  completed: "ring-2 ring-link",
  failed: "ring-2 ring-destructive",
};

export function MissionNodeBox({ data }: NodeProps<MissionNode>) {
  const accent = KIND_ACCENT[data.kind] ?? KIND_ACCENT.unknown;
  return (
    <div
      className={cn(
        "min-w-[160px] max-w-[240px] rounded-md border border-l-4 bg-card px-3 py-2 text-card-foreground shadow-sm",
        accent,
        STATE_RING[data.runState],
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[data.kind] ?? "Node"}
        </span>
        <div className="flex gap-1">
          {data.isEntry && (
            <span className="rounded bg-primary/15 px-1 text-[9px] font-semibold text-primary">
              entry
            </span>
          )}
          {data.isExit && (
            <span className="rounded bg-muted px-1 text-[9px] font-semibold text-muted-foreground">
              exit
            </span>
          )}
        </div>
      </div>
      <div className="truncate text-sm font-medium" title={data.label}>
        {data.label}
      </div>
      {data.summary && (
        <div
          className="truncate text-xs text-muted-foreground"
          title={data.summary}
        >
          {data.summary}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}
