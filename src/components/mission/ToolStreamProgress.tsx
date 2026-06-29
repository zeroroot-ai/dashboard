"use client";

/**
 * ToolStreamProgress, per-tool streaming progress affordance.
 *
 * Subscribes to the dashboard SSE bridge at
 * `/api/missions/:missionId/tool-stream/:invocationId` (which proxies the
 * daemon's `gibson.component.v1.ComponentService/CallToolStream`) and
 * renders a Shadcn UI Progress bar plus the latest progress message.
 *
 * Event taxonomy (sent verbatim by the daemon):
 *   - `progress`  → { percent?: number, message?: string }
 *   - `partial`   → arbitrary partial result payload
 *   - `warning`   → { message: string }
 *   - `error`     → { fatal: boolean, message: string, code?: string }
 *   - `result` / done=true → terminal success
 *
 * On `EventSource.error` or a fatal `error` event the component closes
 * the connection and dispatches a toast (via sonner).
 *
 * Spec: week-4-handlers-ui-e2e §5 tasks 53-55.
 */

import * as React from "react";
import { AlertTriangleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

type StreamState =
  | { kind: "connecting" }
  | { kind: "running"; percent: number | null; message: string }
  | { kind: "complete"; message: string }
  | { kind: "warning"; percent: number | null; message: string }
  | { kind: "failed"; message: string };

interface ProgressPayload {
  percent?: number;
  message?: string;
}

interface ErrorPayload {
  fatal?: boolean;
  message?: string;
  code?: string;
}

interface WarningPayload {
  message?: string;
}

function tryParse<T>(raw: unknown): T | null {
  if (typeof raw !== "string") return (raw as T) ?? null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface ToolStreamProgressProps {
  missionId: string;
  invocationId: string;
  toolName: string;
  /** Optional JSON string passed through to the daemon as `input_json`. */
  inputJson?: string;
  className?: string;
}

export function ToolStreamProgress({
  missionId,
  invocationId,
  toolName,
  inputJson,
  className,
}: ToolStreamProgressProps) {
  const [state, setState] = React.useState<StreamState>({ kind: "connecting" });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    const params = new URLSearchParams({ tool_name: toolName });
    if (inputJson) params.set("input_json", inputJson);
    const url = `/api/missions/${encodeURIComponent(
      missionId,
    )}/tool-stream/${encodeURIComponent(invocationId)}?${params.toString()}`;

    let closed = false;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      setState({ kind: "failed", message: "Unable to open progress stream" });
      return;
    }

    const closeStream = () => {
      if (closed) return;
      closed = true;
      es.close();
    };

    const handleProgress = (ev: MessageEvent) => {
      const outer = tryParse<{ payloadJson?: string }>(ev.data);
      const payload = tryParse<ProgressPayload>(outer?.payloadJson) ?? {};
      setState((prev) => ({
        kind: "running",
        percent:
          typeof payload.percent === "number"
            ? Math.max(0, Math.min(100, payload.percent))
            : prev.kind === "running"
              ? prev.percent
              : null,
        message: payload.message ?? (prev.kind === "running" ? prev.message : ""),
      }));
    };

    const handlePartial = (ev: MessageEvent) => {
      const outer = tryParse<{ payloadJson?: string }>(ev.data);
      const txt =
        outer?.payloadJson && typeof outer.payloadJson === "string"
          ? outer.payloadJson.slice(0, 80)
          : "partial result received";
      setState((prev) => ({
        kind: "running",
        percent: prev.kind === "running" ? prev.percent : null,
        message: txt,
      }));
    };

    const handleWarning = (ev: MessageEvent) => {
      const outer = tryParse<{ payloadJson?: string }>(ev.data);
      const payload = tryParse<WarningPayload>(outer?.payloadJson) ?? {};
      setState((prev) => ({
        kind: "warning",
        percent: prev.kind === "running" ? prev.percent : null,
        message: payload.message ?? "warning",
      }));
    };

    const handleError = (ev: MessageEvent) => {
      const outer = tryParse<{ payloadJson?: string; error?: ErrorPayload }>(
        ev.data,
      );
      const payload =
        tryParse<ErrorPayload>(outer?.payloadJson) ?? outer?.error ?? {};
      const fatal = payload.fatal ?? true;
      const msg = payload.message ?? "Tool execution failed";
      if (fatal) {
        toast.error(`Tool ${toolName} failed`, { description: msg });
        setState({ kind: "failed", message: msg });
        closeStream();
      } else {
        setState((prev) => ({
          kind: "warning",
          percent: prev.kind === "running" ? prev.percent : null,
          message: msg,
        }));
      }
    };

    const handleResult = (ev: MessageEvent) => {
      const outer = tryParse<{ payloadJson?: string }>(ev.data);
      const summary =
        outer?.payloadJson && typeof outer.payloadJson === "string"
          ? outer.payloadJson.slice(0, 80)
          : "complete";
      setState({ kind: "complete", message: summary });
      closeStream();
    };

    es.addEventListener("progress", handleProgress);
    es.addEventListener("partial", handlePartial);
    es.addEventListener("warning", handleWarning);
    es.addEventListener("error", handleError);
    es.addEventListener("result", handleResult);

    es.onerror = () => {
      if (closed) return;
      // Browser-level connection error (network drop). Surface a soft
      // failed state but don't toast, the user already sees the bar
      // turn red.
      setState((prev) =>
        prev.kind === "complete" || prev.kind === "failed"
          ? prev
          : { kind: "failed", message: "Stream connection lost" },
      );
      closeStream();
    };

    return () => {
      es.removeEventListener("progress", handleProgress);
      es.removeEventListener("partial", handlePartial);
      es.removeEventListener("warning", handleWarning);
      es.removeEventListener("error", handleError);
      es.removeEventListener("result", handleResult);
      closeStream();
    };
  }, [missionId, invocationId, toolName, inputJson]);

  const pct = state.kind === "running" || state.kind === "warning" ? state.percent : null;
  const message =
    state.kind === "connecting"
      ? "Connecting..."
      : state.kind === "running" || state.kind === "warning" || state.kind === "complete" || state.kind === "failed"
        ? state.message
        : "";

  return (
    <div
      className={cn(
        "rounded-md border border-border/40 bg-background/60 p-3",
        state.kind === "failed" && "border-destructive/50",
        state.kind === "warning" && "border-amber-500/40",
        state.kind === "complete" && "border-emerald-500/40",
        className,
      )}
      data-testid="tool-stream-progress"
      data-state={state.kind}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{toolName}</span>
        <Badge
          variant="outline"
          className={cn(
            "h-5 gap-1 px-1.5 text-[10px] font-mono uppercase",
            state.kind === "failed"
              ? "border-destructive/50 text-destructive"
              : state.kind === "complete"
                ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                : state.kind === "warning"
                  ? "border-amber-500/40 text-amber-700 dark:text-amber-300"
                  : "",
          )}
        >
          {state.kind === "running" && (
            <Loader2Icon className="size-3 animate-spin" aria-hidden />
          )}
          {state.kind === "complete" && (
            <CheckCircle2Icon className="size-3" aria-hidden />
          )}
          {state.kind === "warning" && (
            <AlertTriangleIcon className="size-3" aria-hidden />
          )}
          {state.kind === "failed" && (
            <AlertTriangleIcon className="size-3" aria-hidden />
          )}
          {state.kind}
        </Badge>
      </div>
      <Progress
        value={pct ?? (state.kind === "complete" ? 100 : state.kind === "failed" ? 0 : 5)}
        className={cn(
          "h-2",
          state.kind === "failed" && "[&>div]:bg-destructive",
          state.kind === "warning" && "[&>div]:bg-amber-500",
        )}
      />
      {message && (
        <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
