"use client";

/**
 * DecisionTimeline — the train-of-thought view of a run (dashboard#533).
 *
 * Renders the run's agent decisions as a readable vertical narrative: which
 * agent acted, what it decided (action), why (reasoning), how sure it was
 * (confidence), and what the step cost (tokens · latency · estimated $). Each
 * entry expands to reveal the underlying conversation, loaded on demand.
 *
 * This is the default run view. The raw span tree lives behind the "Advanced"
 * affordance in RunView — this component never shows observation ids or
 * Langfuse/Gibson-internal vocabulary.
 */

import * as React from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  formatTokenCount,
  formatUsd,
  estimateStepCostUsd,
} from "@/src/lib/trace-utils";
import { ConversationView } from "@/components/gibson/traces/ConversationView";
import { useObservationDetail } from "@/src/hooks/useTraces";
import type { DecisionEntry } from "@/src/types/trace";

/** "enumerate_subdomains" / "llm.chat" → "Enumerate subdomains". */
function humanizeAction(action: string): string {
  const cleaned = action.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "Step";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatClockTime(d: Date): string {
  return new Date(d).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatLatency(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const tone =
    confidence >= 0.75
      ? "border-highlight/40 text-highlight"
      : confidence >= 0.4
        ? "border-warning/40 text-warning"
        : "border-destructive/40 text-destructive";
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
        tone,
      )}
      title="Model-reported confidence in this decision"
    >
      {`conf ${pct}%`}
    </span>
  );
}

function DecisionRow({ decision }: { decision: DecisionEntry }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: detail, isLoading } = useObservationDetail(
    decision.id,
    expanded,
  );

  const agent = decision.targetAgent || "orchestrator";
  const costUsd = estimateStepCostUsd(
    decision.model,
    decision.inputTokens,
    decision.outputTokens,
  );
  const isError = decision.status === "error";

  return (
    <li className="relative pl-6">
      {/* timeline rail + dot */}
      <span
        aria-hidden
        className="absolute left-[5px] top-1.5 size-2 rounded-full bg-highlight/70 ring-2 ring-background"
      />
      <div
        className={cn(
          "rounded-lg border p-3",
          isError
            ? "border-destructive/40 bg-destructive/5"
            : "border-highlight/20 bg-card/40",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono tabular-nums text-muted-foreground">
            {formatClockTime(decision.timestamp)}
          </span>
          <span className="font-semibold text-foreground">{agent}</span>
          {isError && (
            <AlertTriangle className="size-3.5 text-destructive" aria-hidden />
          )}
          <span className="ml-auto flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
            <span title="input / output tokens">
              {formatTokenCount(decision.inputTokens)}/
              {formatTokenCount(decision.outputTokens)}
            </span>
            <span>·</span>
            <span title="step latency">{formatLatency(decision.latencyMs)}</span>
            {costUsd > 0 && (
              <>
                <span>·</span>
                <span title="estimated step cost">{formatUsd(costUsd)}</span>
              </>
            )}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">
            <span className="text-muted-foreground">decided: </span>
            {humanizeAction(decision.action)}
          </span>
          {decision.confidence < 1 && (
            <ConfidenceBadge confidence={decision.confidence} />
          )}
          <span className="font-mono text-[10px] text-muted-foreground">
            {decision.model}
          </span>
        </div>

        {decision.reasoning && (
          <p className="mt-1.5 border-l-2 border-highlight/30 pl-2 text-xs italic text-foreground/80">
            {decision.reasoning}
          </p>
        )}

        {isError && decision.errorMessage && (
          <p className="mt-1.5 text-xs text-destructive">
            {decision.errorMessage}
          </p>
        )}

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 text-xs text-link hover:underline"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          {expanded ? "Hide conversation" : "Show conversation"}
        </button>

        {expanded && (
          <div className="mt-2">
            {isLoading ? (
              <p className="text-xs text-muted-foreground">
                Loading conversation…
              </p>
            ) : detail && detail.contentAvailable ? (
              <ConversationView messages={detail.messages} />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No conversation content was recorded for this step.
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function DecisionTimeline({
  decisions,
}: {
  decisions: DecisionEntry[];
}) {
  if (decisions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No agent decisions were recorded for this run. Switch to{" "}
        <span className="font-medium">Advanced</span> to inspect the raw trace.
      </p>
    );
  }

  return (
    <ol className="relative space-y-3 before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-highlight/20">
      {decisions.map((decision) => (
        <DecisionRow key={decision.id} decision={decision} />
      ))}
    </ol>
  );
}
