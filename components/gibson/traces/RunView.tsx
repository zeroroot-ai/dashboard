"use client";

/**
 * RunView — the single, shared renderer for one run (dashboard#533).
 *
 * Leads with the train-of-thought timeline (what the agents did and why) and
 * keeps the raw span tree behind an explicit "Advanced" toggle. Both the
 * standalone trace page and the mission Traces tab render through this — there
 * is one run renderer, not two.
 *
 * The compact totals strip stays pinned on top; the Spend tab adds the
 * by-agent / by-model breakdown (dashboard#534).
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { TokenSummaryPanel } from "@/components/gibson/traces/TokenSummaryPanel";
import { DecisionTimeline } from "@/components/gibson/traces/DecisionTimeline";
import { SpendView } from "@/components/gibson/traces/SpendView";
import { TraceTree } from "@/components/gibson/traces/TraceTree";
import type { TraceData } from "@/src/types/trace";

type RunTab = "timeline" | "spend" | "advanced";

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-highlight/10 text-highlight"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export function RunView({ data }: { data: TraceData }) {
  const [tab, setTab] = React.useState<RunTab>("timeline");

  return (
    <div className="space-y-4">
      <TokenSummaryPanel
        summary={data.tokenSummary}
        totalDurationMs={data.totalDurationMs}
      />

      <div className="flex items-center gap-1 border-b border-highlight/20 pb-2">
        <TabButton active={tab === "timeline"} onClick={() => setTab("timeline")}>
          Timeline
        </TabButton>
        <TabButton active={tab === "spend"} onClick={() => setTab("spend")}>
          Spend
        </TabButton>
        <TabButton active={tab === "advanced"} onClick={() => setTab("advanced")}>
          Advanced (raw trace)
        </TabButton>
      </div>

      {tab === "timeline" && <DecisionTimeline decisions={data.decisions} />}
      {tab === "spend" && <SpendView summary={data.tokenSummary} />}
      {tab === "advanced" && (
        <div className="glass-hack rounded-lg p-3">
          <div className="flex justify-between border-b border-highlight/30 pb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Raw trace</span>
            <span>input/output · duration</span>
          </div>
          <TraceTree nodes={data.traceTree} />
        </div>
      )}
    </div>
  );
}
