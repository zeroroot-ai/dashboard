"use client";

/**
 * CheckpointDetail, side panel that fetches and renders a full checkpoint.
 *
 * Calls the `getCheckpointAction` Server Action (which proxies to
 * `DaemonService.GetCheckpoint`) for the (missionId, checkpointId) pair
 * and renders:
 *   - Summary metadata (super-step, source, captured-at, size).
 *   - Working memory (msgpack bytes → best-effort JSON-ish preview).
 *   - Mission memory (same).
 *   - DAG steps (one card per step with state + timestamps).
 *   - Findings (id + severity).
 *   - Parallel groups (group-id keyed table).
 *
 * Secret redaction (R15.6) is enforced server-side; whenever a string
 * value reads as `<redacted:secret>` we render a "secret redacted" badge
 * in its place.
 *
 * Spec: week-4-handlers-ui-e2e §4 task 36.
 */

import * as React from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EyeOffIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getCheckpointAction,
  type GetCheckpointActionResult,
} from "@/src/components/mission/checkpoint-actions";
import {
  CheckpointSource,
  type CheckpointSummary,
  type Checkpoint,
  type DagStep,
  type FindingSnapshot,
  type ParallelGroupState,
} from "@/src/gen/gibson/daemon/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REDACTED_MARKER = "<redacted:secret>";

function sourceLabel(src?: CheckpointSource): string {
  switch (src) {
    case CheckpointSource.SUPER_STEP:
      return "super-step";
    case CheckpointSource.APPROVAL_GATE:
      return "approval-gate";
    case CheckpointSource.GRACEFUL_SHUTDOWN:
      return "shutdown";
    case CheckpointSource.PARALLEL_GROUP:
      return "parallel-group";
    case CheckpointSource.MANUAL:
      return "manual";
    default:
      return "unspecified";
  }
}

function timestampToDate(ts?: { seconds: bigint; nanos: number }): Date | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6));
}

/**
 * Best-effort decoder for msgpack/opaque bytes. Tries:
 *   1. UTF-8 decode + JSON.parse → renders a JSON tree.
 *   2. UTF-8 decode (raw) → renders pre-formatted text.
 *   3. fall back to base64 size summary so we never block on non-text bytes.
 *
 * The daemon writes msgpack to these fields, but the secret redaction
 * pass on the server upgrades known-string values to the literal
 * `<redacted:secret>` marker, which survives JSON.stringify cleanly so
 * the UI still gets a structured tree to walk. We don't ship a full
 * msgpack decoder client-side, keeping the bundle lean, and a "raw
 * bytes" fallback is the right thing on un-decodable payloads.
 */
function decodeMemory(bytes: Uint8Array): {
  kind: "json" | "text" | "binary";
  value: unknown;
  size: number;
} {
  const size = bytes.byteLength;
  if (size === 0) return { kind: "json", value: null, size };
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    try {
      return { kind: "json", value: JSON.parse(text), size };
    } catch {
      return { kind: "text", value: text, size };
    }
  } catch {
    return { kind: "binary", value: null, size };
  }
}

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

// ---------------------------------------------------------------------------
// JSON tree renderer with redaction awareness.
// ---------------------------------------------------------------------------

function isRedacted(value: unknown): boolean {
  return typeof value === "string" && value === REDACTED_MARKER;
}

function RedactedBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 gap-1 px-1.5 text-[10px] font-mono text-amber-600 dark:text-amber-400"
    >
      <EyeOffIcon className="size-3" aria-hidden />
      secret redacted
    </Badge>
  );
}

function JsonNode({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (isRedacted(value)) {
    return <RedactedBadge />;
  }
  if (value === null) {
    return <span className="font-mono text-xs text-muted-foreground">null</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="break-all font-mono text-xs text-emerald-700 dark:text-emerald-400">
        &quot;{value}&quot;
      </span>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <span className="font-mono text-xs text-blue-700 dark:text-blue-400">
        {String(value)}
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0)
      return <span className="font-mono text-xs text-muted-foreground">[]</span>;
    return (
      <Collapsible defaultOpen={depth < 1}>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
          <span className="font-mono">[{value.length}]</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-4 border-l border-border/40 pl-3">
            {value.map((item, i) => (
              <li key={i} className="py-0.5">
                <span className="mr-2 font-mono text-xs text-muted-foreground">
                  {i}:
                </span>
                <JsonNode value={item} depth={depth + 1} />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0)
      return <span className="font-mono text-xs text-muted-foreground">{"{}"}</span>;
    return (
      <Collapsible defaultOpen={depth < 1}>
        <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
          <span className="font-mono">
            &#123;{entries.length} key{entries.length === 1 ? "" : "s"}&#125;
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="ml-4 border-l border-border/40 pl-3">
            {entries.map(([k, v]) => (
              <li key={k} className="py-0.5">
                <span className="mr-2 font-mono text-xs font-medium text-purple-700 dark:text-purple-400">
                  {k}:
                </span>
                <JsonNode value={v} depth={depth + 1} />
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    );
  }
  return <span className="font-mono text-xs">{String(value)}</span>;
}

// ---------------------------------------------------------------------------
// Memory section
// ---------------------------------------------------------------------------

function MemorySection({
  title,
  bytes,
  defaultOpen,
}: {
  title: string;
  bytes: Uint8Array;
  defaultOpen?: boolean;
}) {
  const decoded = decodeMemory(bytes);
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded border border-border/40 bg-muted/30 px-3 py-1.5 text-left">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
          {title}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {formatBytes(decoded.size)} · {decoded.kind}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border border-t-0 border-border/40 bg-background/60 p-3">
        {decoded.kind === "json" ? (
          <JsonNode value={decoded.value} />
        ) : decoded.kind === "text" ? (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
            {String(decoded.value)}
          </pre>
        ) : (
          <p className="text-xs text-muted-foreground">
            Binary payload ({formatBytes(decoded.size)}); not text-decodable.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// DAG steps
// ---------------------------------------------------------------------------

function DagStepCard({ step }: { step: DagStep }) {
  const startedAt = timestampToDate(step.startedAt);
  const finishedAt = timestampToDate(step.finishedAt);
  return (
    <div className="rounded border border-border/40 bg-background/60 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{step.nodeId}</span>
        <Badge
          variant="outline"
          className="h-5 px-1.5 text-[10px] font-mono uppercase"
        >
          {step.state || "unknown"}
        </Badge>
      </div>
      <div className="mt-1 grid gap-1 text-[10px] text-muted-foreground">
        <span>start: {startedAt?.toISOString() ?? "-"}</span>
        <span>finish: {finishedAt?.toISOString() ?? "-"}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function FindingRow({ f }: { f: FindingSnapshot }) {
  return (
    <li className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-b-0">
      <span className="font-mono text-xs">{f.findingId}</span>
      <Badge
        variant="outline"
        className="h-5 px-1.5 text-[10px] font-mono uppercase"
      >
        {f.severity || "unknown"}
      </Badge>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Parallel groups
// ---------------------------------------------------------------------------

function ParallelGroupRow({
  groupId,
  state,
}: {
  groupId: string;
  state: ParallelGroupState;
}) {
  return (
    <li className="grid grid-cols-3 items-center gap-2 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="truncate font-mono text-xs" title={groupId}>
        {groupId}
      </span>
      <span className="font-mono text-xs text-muted-foreground">
        {state.completed}/{state.expected}
      </span>
      <span className="truncate text-right font-mono text-[10px] text-muted-foreground">
        {state.completedNodeIds.length} done
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface CheckpointDetailProps {
  missionId: string;
  checkpointId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function SummaryHeader({ summary }: { summary: CheckpointSummary }) {
  const captured = timestampToDate(summary.capturedAt);
  return (
    <div className="grid grid-cols-2 gap-2 rounded border border-border/40 bg-muted/30 p-3 text-xs">
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">
          Super-step
        </p>
        <p className="font-mono">{summary.superStep.toString()}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">Source</p>
        <p className="font-mono">{sourceLabel(summary.source)}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">
          Captured at
        </p>
        <p className="font-mono">{captured?.toISOString() ?? "-"}</p>
      </div>
      <div>
        <p className="text-[10px] uppercase text-muted-foreground">Size</p>
        <p className="font-mono">{formatBytes(Number(summary.sizeBytes))}</p>
      </div>
      {summary.parallelGroupId && (
        <div className="col-span-2">
          <p className="text-[10px] uppercase text-muted-foreground">
            Parallel group
          </p>
          <p className="font-mono">{summary.parallelGroupId}</p>
        </div>
      )}
    </div>
  );
}

function CheckpointBody({ checkpoint }: { checkpoint: Checkpoint }) {
  const parallel = Object.entries(checkpoint.parallelGroups);
  return (
    <div className="space-y-3">
      {checkpoint.summary && <SummaryHeader summary={checkpoint.summary} />}

      <MemorySection
        title="Working memory"
        bytes={checkpoint.workingMemory}
        defaultOpen
      />
      <MemorySection
        title="Mission memory"
        bytes={checkpoint.missionMemory}
      />

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded border border-border/40 bg-muted/30 px-3 py-1.5 text-sm font-medium">
          <span className="flex items-center gap-2">
            <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
            DAG steps
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {checkpoint.steps.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border border-t-0 border-border/40 bg-background/60 p-3">
          {checkpoint.steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No steps recorded.</p>
          ) : (
            <div className="grid gap-2">
              {checkpoint.steps.map((s) => (
                <DagStepCard key={s.nodeId} step={s} />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center justify-between rounded border border-border/40 bg-muted/30 px-3 py-1.5 text-sm font-medium">
          <span className="flex items-center gap-2">
            <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
            Findings
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {checkpoint.findings.length}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border border-t-0 border-border/40 bg-background/60 p-3">
          {checkpoint.findings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No findings captured.
            </p>
          ) : (
            <ul>
              {checkpoint.findings.map((f) => (
                <FindingRow key={f.findingId} f={f} />
              ))}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>

      {parallel.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="group flex w-full items-center justify-between rounded border border-border/40 bg-muted/30 px-3 py-1.5 text-sm font-medium">
            <span className="flex items-center gap-2">
              <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
              Parallel groups
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {parallel.length}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent className="border border-t-0 border-border/40 bg-background/60 p-3">
            <ul>
              {parallel.map(([groupId, state]) => (
                <ParallelGroupRow
                  key={groupId}
                  groupId={groupId}
                  state={state}
                />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

export function CheckpointDetail({
  missionId,
  checkpointId,
  open,
  onOpenChange,
}: CheckpointDetailProps) {
  const [result, setResult] =
    React.useState<GetCheckpointActionResult | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    void (async () => {
      const r = await getCheckpointAction({
        missionId,
        checkpointId,
        includeBlobs: false,
      });
      if (cancelled) return;
      setResult(r);
      setLoading(false);
      if (!r.ok) {
        toast.error(`Failed to load checkpoint: ${r.message}`, {
          description: r.codeName,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, missionId, checkpointId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle className="font-mono text-base">
            Checkpoint {checkpointId.slice(-8)}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">
            Mission {missionId}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3">
          {loading && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded" />
              ))}
            </div>
          )}

          {result && !result.ok && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">Failed to load checkpoint</p>
              <p className="mt-1 text-xs opacity-80">{result.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="mt-2 gap-1.5 text-xs"
              >
                <XIcon className="size-3" aria-hidden />
                Close
              </Button>
            </div>
          )}

          {result && result.ok && result.response.checkpoint && (
            <CheckpointBody checkpoint={result.response.checkpoint} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
