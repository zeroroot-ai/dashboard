"use client";

/**
 * CallsList, the calls view of a run (gibson#755).
 *
 * Renders the run's LLM calls as a vertical list: which model answered, the
 * call's input/output token spend, and an expander that loads the call's full
 * prompt ↔ response transcript on demand (WorldService.GetLlmCall). This is the
 * default run view; it replaces the Langfuse decision/observation timeline,
 * which the flat World call log has no equivalent for.
 */

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  formatTokenCount,
  formatUsd,
  estimateCallCostUsd,
} from "@/src/lib/world-traces";
import { ConversationView } from "@/components/gibson/traces/ConversationView";
import { useCallTranscript } from "@/src/hooks/useTraces";
import type { LlmCallSummary, ConversationMessage } from "@/src/types/trace";

function CallRow({ call, index }: { call: LlmCallSummary; index: number }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: detail, isLoading } = useCallTranscript(call.callId, expanded);

  const costUsd = estimateCallCostUsd(
    call.model,
    call.promptTokens,
    call.completionTokens,
  );

  // The completion is the assistant's reply; append it to the prompt messages
  // so the transcript reads as a full exchange.
  const messages: ConversationMessage[] = React.useMemo(() => {
    if (!detail) return [];
    const msgs = [...detail.messages];
    if (detail.completion) {
      msgs.push({ role: "assistant", content: detail.completion });
    }
    return msgs;
  }, [detail]);

  return (
    <li className="relative pl-6">
      <span
        aria-hidden
        className="absolute left-[5px] top-2 size-2 rounded-full bg-highlight/70 ring-2 ring-background"
      />
      <div className="rounded-lg border border-highlight/20 bg-card/40 p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-mono tabular-nums text-muted-foreground">
            #{index + 1}
          </span>
          <span className="font-mono text-foreground">{call.model || "unknown"}</span>
          <span className="ml-auto flex items-center gap-2 font-mono tabular-nums text-muted-foreground">
            <span title="input / output tokens">
              {formatTokenCount(call.promptTokens)}/
              {formatTokenCount(call.completionTokens)}
            </span>
            {costUsd > 0 && (
              <>
                <span>·</span>
                <span title="estimated cost">{formatUsd(costUsd)}</span>
              </>
            )}
          </span>
        </div>

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
          {expanded ? "Hide transcript" : "Show transcript"}
        </button>

        {expanded && (
          <div className="mt-2">
            {isLoading ? (
              <p className="text-xs text-muted-foreground">Loading transcript…</p>
            ) : detail && messages.length > 0 ? (
              <ConversationView
                messages={messages}
                tokens={{ input: call.promptTokens, output: call.completionTokens }}
              />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No transcript was recorded for this call.
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export function CallsList({ calls }: { calls: LlmCallSummary[] }) {
  if (calls.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No LLM calls were recorded for this run.
      </p>
    );
  }

  return (
    <ol className="relative space-y-3 before:absolute before:left-[5px] before:top-1 before:bottom-1 before:w-px before:bg-highlight/20">
      {calls.map((call, i) => (
        <CallRow key={call.callId || i} call={call} index={i} />
      ))}
    </ol>
  );
}
