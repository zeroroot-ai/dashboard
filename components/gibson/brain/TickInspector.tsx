"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import type { ChangeType, FrameDiff } from "@/components/gibson/brain/frame-diff";
import {
  isDecisionEvent,
  llmCallIdForEvent,
  type TickEvent,
} from "@/components/gibson/brain/llm-tick";

type LlmMessage = { role: string; content: string };
type LlmCall = {
  callId: string;
  runId: string;
  model: string;
  scopeId: string;
  promptTokens: number;
  completionTokens: number;
  messages: LlmMessage[];
  completion: string;
};

function changeVariant(c: ChangeType): "success" | "info" | "destructive" {
  if (c === "added") return "success";
  if (c === "changed") return "info";
  return "destructive";
}

/**
 * TickInspector is the per-tick detail panel of the mission-run World view
 * (epic ecs-brain, gibson#1059). For the selected Timeline tick it shows three
 * things, all without a new backend: WHAT CHANGED — the entity set diffed
 * client-side from the folded frame at seq N-1 vs N (`diffFrames`); the Decider
 * RATIONALE when the tick is a decision event (richer once the decisions fold
 * lands, gibson#1060 — shown from the event summary until then); and, for an LLM
 * tick, its TRANSCRIPT fetched on demand via GetLlmCall (/api/world/llm-call).
 * The graph highlight of the same delta is driven by the caller from `diff`.
 */
export function TickInspector({
  event,
  diff,
  loading,
  onClose,
}: {
  event: TickEvent;
  diff: FrameDiff | null;
  loading: boolean;
  onClose: () => void;
}) {
  const callId = llmCallIdForEvent(event);
  const [call, setCall] = useState<LlmCall | null>(null);
  const [callLoading, setCallLoading] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  // Reset the transcript whenever the selected tick changes — a stale transcript
  // must never bleed across ticks.
  useEffect(() => {
    setCall(null);
    setCallError(null);
    setCallLoading(false);
  }, [event.seq, callId]);

  const loadTranscript = useCallback(async () => {
    if (!callId) return;
    setCallLoading(true);
    setCallError(null);
    try {
      const res = await fetch(
        `/api/world/llm-call?callId=${encodeURIComponent(callId)}`,
      );
      if (!res.ok) throw new Error(`transcript read failed (${res.status})`);
      setCall((await res.json()) as LlmCall);
    } catch (e) {
      setCallError(e instanceof Error ? e.message : "failed to load transcript");
    } finally {
      setCallLoading(false);
    }
  }, [callId]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="flex items-center gap-3">
          <span>Tick {event.seq}</span>
          <Badge variant="outline" className="font-mono">
            {event.kind}
          </Badge>
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {isDecisionEvent(event) ? (
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Decider rationale</h3>
            <p className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {event.summary}
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">What changed</h3>
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : !diff || diff.entities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No entity changes at this tick.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {diff.entities.map((e) => (
                <li key={`${e.change}:${e.id}`} className="flex items-center gap-2">
                  <Badge variant={changeVariant(e.change)}>{e.change}</Badge>
                  <span className="text-xs text-muted-foreground">{e.kind}</span>
                  <span className="truncate text-sm">{e.label}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {callId ? (
          <section className="flex flex-col gap-3">
            <Separator />
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold">LLM transcript</h3>
              {!call ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadTranscript()}
                  disabled={callLoading}
                >
                  {callLoading ? "Loading…" : "View transcript"}
                </Button>
              ) : null}
            </div>
            {callError ? (
              <p className="text-sm text-destructive">{callError}</p>
            ) : null}
            {call ? (
              <div className="flex flex-col gap-3">
                <p className="font-mono text-xs text-muted-foreground">
                  {call.model} · {call.promptTokens + call.completionTokens} tokens
                </p>
                {call.messages.map((m, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <Badge variant="outline" className="w-fit">
                      {m.role}
                    </Badge>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {m.content}
                    </p>
                  </div>
                ))}
                {call.completion ? (
                  <div className="flex flex-col gap-1">
                    <Badge variant="success" className="w-fit">
                      completion
                    </Badge>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {call.completion}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
