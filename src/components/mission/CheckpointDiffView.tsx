"use client";

/**
 * CheckpointDiffView, split-pane diff between two checkpoints.
 *
 * Calls `diffCheckpointsAction` first; on `ResourceExhausted` (gRPC code
 * 8) falls back to two `getCheckpointAction` calls and a client-side
 * diff walk over the JSON-decoded payloads.
 *
 * Highlighting:
 *   - ADDED  → emerald
 *   - REMOVED → rose
 *   - CHANGED → amber
 *
 * Spec: week-4-handlers-ui-e2e §4 tasks 37, 38, 44.
 */

import * as React from "react";
import { Code } from "@connectrpc/connect";
import { AlertTriangleIcon, MinusIcon, PencilIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import {
  diffCheckpointsAction,
  getCheckpointAction,
  type CheckpointActionError,
} from "@/src/components/mission/checkpoint-actions";
import {
  CheckpointDiffSchema,
  type CheckpointDiff,
  type DagStepDelta,
  type FindingDelta,
  type MemoryKeyDelta,
  type ParallelGroupDelta,
  MemoryKeyDelta_Op,
  DagStepDelta_Op,
  FindingDelta_Op,
} from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { create } from "@bufbuild/protobuf";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function decodeBytes(bytes: Uint8Array): unknown {
  if (bytes.byteLength === 0) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch {
    return `<binary:${bytes.byteLength}B>`;
  }
}

function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

type DeltaOp = "added" | "removed" | "changed";

function memOp(op: MemoryKeyDelta_Op): DeltaOp | null {
  switch (op) {
    case MemoryKeyDelta_Op.ADDED:
      return "added";
    case MemoryKeyDelta_Op.REMOVED:
      return "removed";
    case MemoryKeyDelta_Op.CHANGED:
      return "changed";
    default:
      return null;
  }
}

function dagOp(op: DagStepDelta_Op): DeltaOp | null {
  switch (op) {
    case DagStepDelta_Op.ADDED:
      return "added";
    case DagStepDelta_Op.REMOVED:
      return "removed";
    case DagStepDelta_Op.CHANGED:
      return "changed";
    default:
      return null;
  }
}

function findingOp(op: FindingDelta_Op): DeltaOp | null {
  switch (op) {
    case FindingDelta_Op.ADDED:
      return "added";
    case FindingDelta_Op.REMOVED:
      return "removed";
    case FindingDelta_Op.CHANGED:
      return "changed";
    default:
      return null;
  }
}

const opStyles: Record<DeltaOp, string> = {
  added:
    "bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
  removed: "bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-300",
  changed:
    "bg-amber-500/10 border-amber-500/40 text-amber-700 dark:text-amber-300",
};

function OpBadge({ op }: { op: DeltaOp }) {
  const Icon = op === "added" ? PlusIcon : op === "removed" ? MinusIcon : PencilIcon;
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-5 gap-1 px-1.5 text-[10px] font-mono uppercase",
        opStyles[op],
      )}
    >
      <Icon className="size-3" aria-hidden />
      {op}
    </Badge>
  );
}

function SidePanel({
  label,
  value,
  op,
}: {
  label: string;
  value: unknown;
  op: DeltaOp;
}) {
  // For added → only the right pane has content; for removed → only left.
  const empty = value === null || value === undefined;
  return (
    <div
      className={cn(
        "rounded border bg-background/60 p-2",
        op === "added" && "border-emerald-500/30",
        op === "removed" && "border-rose-500/30",
        op === "changed" && "border-amber-500/30",
      )}
    >
      <p className="mb-1 text-[10px] uppercase text-muted-foreground">
        {label}
      </p>
      {empty ? (
        <p className="text-xs italic text-muted-foreground">(absent)</p>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-xs">
          {stringifyValue(value)}
        </pre>
      )}
    </div>
  );
}

function DeltaRow({
  title,
  op,
  before,
  after,
}: {
  title: string;
  op: DeltaOp;
  before: unknown;
  after: unknown;
}) {
  return (
    <div className="rounded border border-border/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{title}</span>
        <OpBadge op={op} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <SidePanel label="Before (A)" value={before} op={op} />
        <SidePanel label="After (B)" value={after} op={op} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Server-diff render
// ---------------------------------------------------------------------------

function renderMemoryDeltas(
  title: string,
  deltas: MemoryKeyDelta[],
): React.ReactNode {
  if (deltas.length === 0) {
    return (
      <p className="rounded border border-border/40 bg-background/60 p-2 text-xs text-muted-foreground">
        No changes in {title.toLowerCase()}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {deltas.map((d) => {
        const op = memOp(d.op);
        if (!op) return null;
        return (
          <DeltaRow
            key={`${title}:${d.key}`}
            title={d.key}
            op={op}
            before={op === "added" ? null : decodeBytes(d.before)}
            after={op === "removed" ? null : decodeBytes(d.after)}
          />
        );
      })}
    </div>
  );
}

function renderDagDeltas(deltas: DagStepDelta[]): React.ReactNode {
  if (deltas.length === 0) {
    return (
      <p className="rounded border border-border/40 bg-background/60 p-2 text-xs text-muted-foreground">
        No DAG changes.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {deltas.map((d) => {
        const op = dagOp(d.op);
        if (!op) return null;
        return (
          <DeltaRow
            key={`dag:${d.nodeId}`}
            title={`step ${d.nodeId}`}
            op={op}
            before={op === "added" ? null : decodeBytes(d.before)}
            after={op === "removed" ? null : decodeBytes(d.after)}
          />
        );
      })}
    </div>
  );
}

function renderFindingDeltas(deltas: FindingDelta[]): React.ReactNode {
  if (deltas.length === 0) {
    return (
      <p className="rounded border border-border/40 bg-background/60 p-2 text-xs text-muted-foreground">
        No finding changes.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {deltas.map((d) => {
        const op = findingOp(d.op);
        if (!op) return null;
        return (
          <DeltaRow
            key={`finding:${d.findingId}`}
            title={`finding ${d.findingId}`}
            op={op}
            before={op === "added" ? null : decodeBytes(d.before)}
            after={op === "removed" ? null : decodeBytes(d.after)}
          />
        );
      })}
    </div>
  );
}

function renderParallelGroupDeltas(deltas: ParallelGroupDelta[]): React.ReactNode {
  if (!deltas || deltas.length === 0) {
    return (
      <p className="rounded border border-border/40 bg-background/60 p-2 text-xs text-muted-foreground">
        No parallel-group changes.
      </p>
    );
  }
  // Generic: render as JSON for now (the proto schema for ParallelGroupDelta
  // is small; structurally this is enough for v1).
  return (
    <pre className="max-h-64 overflow-auto rounded border border-border/40 bg-background/60 p-2 font-mono text-xs">
      {JSON.stringify(deltas, null, 2)}
    </pre>
  );
}

function ServerDiff({ diff }: { diff: CheckpointDiff }) {
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-2 text-sm font-semibold">Working memory</h3>
        {renderMemoryDeltas("Working memory", diff.workingMemoryDeltas)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Mission memory</h3>
        {renderMemoryDeltas("Mission memory", diff.missionMemoryDeltas)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">DAG steps</h3>
        {renderDagDeltas(diff.dagStepDeltas)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Findings</h3>
        {renderFindingDeltas(diff.findingDeltas)}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Parallel groups</h3>
        {renderParallelGroupDeltas(diff.parallelGroupDeltas)}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client-side fallback diff (R17.4 fallback)
// ---------------------------------------------------------------------------

interface ClientFallbackEntry {
  path: string;
  op: DeltaOp;
  before: unknown;
  after: unknown;
}

function clientDiff(
  before: unknown,
  after: unknown,
  path: string,
  out: ClientFallbackEntry[],
): void {
  const beforeIsObj =
    before !== null && typeof before === "object" && !Array.isArray(before);
  const afterIsObj =
    after !== null && typeof after === "object" && !Array.isArray(after);
  if (beforeIsObj && afterIsObj) {
    const bo = before as Record<string, unknown>;
    const ao = after as Record<string, unknown>;
    const keys = new Set([...Object.keys(bo), ...Object.keys(ao)]);
    for (const k of keys) {
      const child = path ? `${path}.${k}` : k;
      const inB = k in bo;
      const inA = k in ao;
      if (inB && !inA) {
        out.push({ path: child, op: "removed", before: bo[k], after: null });
      } else if (!inB && inA) {
        out.push({ path: child, op: "added", before: null, after: ao[k] });
      } else {
        clientDiff(bo[k], ao[k], child, out);
      }
    }
    return;
  }
  // Leaves: scalar / array / mismatch
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    if (before === undefined || before === null) {
      out.push({ path, op: "added", before: null, after });
    } else if (after === undefined || after === null) {
      out.push({ path, op: "removed", before, after: null });
    } else {
      out.push({ path, op: "changed", before, after });
    }
  }
}

function ClientDiff({ entries }: { entries: ClientFallbackEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="rounded border border-border/40 bg-background/60 p-2 text-xs text-muted-foreground">
        No differences detected.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <DeltaRow
          key={`${e.path}-${i}`}
          title={e.path || "(root)"}
          op={e.op}
          before={e.before}
          after={e.after}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CheckpointDiffViewProps {
  missionId: string;
  checkpointAId: string;
  checkpointBId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ViewState =
  | { kind: "loading" }
  | { kind: "server"; diff: CheckpointDiff }
  | { kind: "fallback"; entries: ClientFallbackEntry[] }
  | { kind: "error"; error: CheckpointActionError };

export function CheckpointDiffView({
  missionId,
  checkpointAId,
  checkpointBId,
  open,
  onOpenChange,
}: CheckpointDiffViewProps) {
  const [state, setState] = React.useState<ViewState>({ kind: "loading" });
  const [usedFallback, setUsedFallback] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState({ kind: "loading" });
    setUsedFallback(false);

    void (async () => {
      const r = await diffCheckpointsAction({
        missionId,
        checkpointAId,
        checkpointBId,
      });
      if (cancelled) return;
      if (r.ok && r.response.diff) {
        setState({ kind: "server", diff: r.response.diff });
        return;
      }
      if (!r.ok && r.code === Code.ResourceExhausted) {
        setUsedFallback(true);
        toast.warning("Server-side diff exhausted; computing client-side", {
          description:
            "Diff is too large for server-side computation. Rendering may be slow.",
        });
        // Fetch both checkpoints and run a recursive walk.
        const [a, b] = await Promise.all([
          getCheckpointAction({
            missionId,
            checkpointId: checkpointAId,
            includeBlobs: false,
          }),
          getCheckpointAction({
            missionId,
            checkpointId: checkpointBId,
            includeBlobs: false,
          }),
        ]);
        if (cancelled) return;
        if (!a.ok) {
          setState({ kind: "error", error: a });
          return;
        }
        if (!b.ok) {
          setState({ kind: "error", error: b });
          return;
        }
        const aDecoded = {
          working_memory: decodeBytes(a.response.checkpoint?.workingMemory ?? new Uint8Array()),
          mission_memory: decodeBytes(a.response.checkpoint?.missionMemory ?? new Uint8Array()),
          steps: a.response.checkpoint?.steps ?? [],
          findings: a.response.checkpoint?.findings ?? [],
        };
        const bDecoded = {
          working_memory: decodeBytes(b.response.checkpoint?.workingMemory ?? new Uint8Array()),
          mission_memory: decodeBytes(b.response.checkpoint?.missionMemory ?? new Uint8Array()),
          steps: b.response.checkpoint?.steps ?? [],
          findings: b.response.checkpoint?.findings ?? [],
        };
        const out: ClientFallbackEntry[] = [];
        clientDiff(aDecoded, bDecoded, "", out);
        setState({ kind: "fallback", entries: out });
        return;
      }
      if (!r.ok) {
        toast.error(`Failed to diff: ${r.message}`, {
          description: r.codeName,
        });
        setState({ kind: "error", error: r });
        return;
      }
      // ok but missing diff, treat as empty
      setState({
        kind: "server",
        diff: create(CheckpointDiffSchema, {
          workingMemoryDeltas: [],
          missionMemoryDeltas: [],
          dagStepDeltas: [],
          findingDeltas: [],
          parallelGroupDeltas: [],
        }),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [open, missionId, checkpointAId, checkpointBId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[90vw] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">
            Diff {checkpointAId.slice(-8)} → {checkpointBId.slice(-8)}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            Mission {missionId}
          </DialogDescription>
        </DialogHeader>

        {usedFallback && state.kind !== "error" && (
          <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            <AlertTriangleIcon
              className="mt-0.5 size-3.5 text-amber-600 dark:text-amber-400"
              aria-hidden
            />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                Diff too large for server-side computation
              </p>
              <p className="text-amber-700/80 dark:text-amber-300/80">
                Computing the diff client-side. Rendering may be slow.
              </p>
            </div>
          </div>
        )}

        {state.kind === "loading" && (
          <div className="space-y-3 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded" />
            ))}
          </div>
        )}

        {state.kind === "error" && (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p className="font-medium">Failed to diff checkpoints</p>
            <p className="mt-1 text-xs opacity-80">{state.error.message}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="mt-2 text-xs"
            >
              Close
            </Button>
          </div>
        )}

        {state.kind === "server" && <ServerDiff diff={state.diff} />}
        {state.kind === "fallback" && <ClientDiff entries={state.entries} />}
      </DialogContent>
    </Dialog>
  );
}
