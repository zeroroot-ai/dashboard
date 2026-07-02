"use client";

/**
 * RunView, the single shared renderer for one run (gibson#755).
 *
 * Leads with the run's by-model token totals, then two tabs:
 *  - Calls: the run's LLM calls in order, each expandable into its full
 *    prompt ↔ response transcript (loaded on demand).
 *  - Spend: the by-model token / estimated-cost breakdown.
 *
 * Both the standalone trace page and any embedded run view render through this,
 * there is one run renderer.
 */

import * as React from "react";

import { cn } from "@/lib/utils";
import { TokenSummaryPanel } from "@/components/gibson/traces/TokenSummaryPanel";
import { CallsList } from "@/components/gibson/traces/CallsList";
import { SpendView } from "@/components/gibson/traces/SpendView";
import type { LlmRun, TokenSummary } from "@/src/types/trace";

type RunTab = "calls" | "spend";

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

export function RunView({
  run,
  tokenSummary,
}: {
  run: LlmRun;
  tokenSummary: TokenSummary;
}) {
  const [tab, setTab] = React.useState<RunTab>("calls");

  return (
    <div className="space-y-4">
      <TokenSummaryPanel summary={tokenSummary} />

      <div className="flex items-center gap-1 border-b border-highlight/20 pb-2">
        <TabButton active={tab === "calls"} onClick={() => setTab("calls")}>
          Calls
        </TabButton>
        <TabButton active={tab === "spend"} onClick={() => setTab("spend")}>
          Spend
        </TabButton>
      </div>

      {tab === "calls" && <CallsList calls={run.calls} />}
      {tab === "spend" && <SpendView summary={tokenSummary} />}
    </div>
  );
}
