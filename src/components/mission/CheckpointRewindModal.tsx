"use client";

/**
 * CheckpointRewindModal, confirmation modal for `Mission.Resume` rewind.
 *
 * Calls `resumeMissionAction({ missionId, targetCheckpointId })` to rewind a
 * mission to an earlier checkpoint.
 *
 * Defense-in-depth UX (Spec mission-checkpointing R17.5):
 *   - Lists every newer checkpoint that will be discarded.
 *   - Lists in-flight tools that will be cancelled (pulled from the latest
 *     checkpoint's `inFlightIdempotency`).
 *   - Requires the operator to TYPE the mission ID exactly. The Confirm
 *     button is disabled until the typed value matches `missionId`.
 *
 * Spec: week-4-handlers-ui-e2e §4 task 39, 41, 44.
 */

import * as React from "react";
import { HistoryIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { resumeMissionAction } from "@/src/components/mission/checkpoint-actions";
import type { CheckpointSummary } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { ToolIdempotency } from "@/src/gen/gibson/manifest/v1/manifest_pb";

function checkpointShortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

function timestampToDate(ts?: { seconds: bigint; nanos: number }): Date | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6));
}

function idempotencyLabel(i: ToolIdempotency): string {
  switch (i) {
    case ToolIdempotency.AT_MOST_ONCE:
      return "at-most-once";
    case ToolIdempotency.AT_LEAST_ONCE:
      return "at-least-once";
    case ToolIdempotency.EXACTLY_ONCE:
      return "exactly-once";
    default:
      return "unknown";
  }
}

interface CheckpointRewindModalProps {
  missionId: string;
  /** Checkpoint the user wants to rewind to. */
  target: CheckpointSummary;
  /** Newer checkpoints that will be discarded. */
  discarded: CheckpointSummary[];
  /** The latest checkpoint, used to read in-flight tools. */
  latest: CheckpointSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful rewind so the parent can refresh. */
  onRewound: () => void;
}

export function CheckpointRewindModal({
  missionId,
  target,
  discarded,
  latest,
  open,
  onOpenChange,
  onRewound,
}: CheckpointRewindModalProps) {
  const [typedId, setTypedId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Reset typed value whenever the modal closes.
  React.useEffect(() => {
    if (!open) setTypedId("");
  }, [open]);

  const idMatches = typedId.trim() === missionId.trim() && missionId.length > 0;
  const targetCaptured = timestampToDate(target.capturedAt);

  const inFlight = latest?.inFlightIdempotency ?? ToolIdempotency.UNSPECIFIED;
  const showInFlightWarning = inFlight !== ToolIdempotency.UNSPECIFIED;

  const handleConfirm = async () => {
    if (!idMatches || submitting) return;
    setSubmitting(true);
    try {
      const r = await resumeMissionAction({
        missionId,
        targetCheckpointId: target.checkpointId,
      });
      if (!r.ok) {
        toast.error(`Failed to rewind: ${r.message}`, {
          description: r.codeName,
        });
        return;
      }
      const meta = r.checkpointMetadata;
      const detail = meta
        ? `Resumed from checkpoint ${meta.checkpointId.slice(-8)}`
        : "Resume signal accepted";
      toast.success(`Rewind started`, { description: detail });
      onOpenChange(false);
      onRewound();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HistoryIcon className="size-4" aria-hidden />
            Rewind mission to checkpoint {checkpointShortId(target.checkpointId)}
          </DialogTitle>
          <DialogDescription>
            This is a destructive operation. Newer checkpoints will be
            discarded and any in-flight tool calls at the time of the latest
            checkpoint will be cancelled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Target summary */}
          <div className="rounded border border-border/40 bg-muted/30 p-3 text-xs">
            <p className="text-[10px] uppercase text-muted-foreground">
              Rewinding to
            </p>
            <p className="font-mono">
              {target.checkpointId} · super-step {target.superStep.toString()}
            </p>
            <p className="font-mono text-muted-foreground">
              captured {targetCaptured?.toISOString() ?? "-"}
            </p>
          </div>

          {/* Discarded list */}
          <div>
            <p className="mb-1 text-xs font-medium">
              Will be discarded ({discarded.length})
            </p>
            {discarded.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No newer checkpoints, rewinding to the latest checkpoint is a
                no-op for the timeline but still re-executes from this point.
              </p>
            ) : (
              <ul className="max-h-40 overflow-y-auto rounded border border-border/40 bg-background/60 p-2">
                {discarded.map((d) => {
                  const ts = timestampToDate(d.capturedAt);
                  return (
                    <li
                      key={d.checkpointId}
                      className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-b-0"
                    >
                      <span className="font-mono text-xs">
                        {checkpointShortId(d.checkpointId)} · #
                        {d.superStep.toString()}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {ts?.toISOString() ?? "-"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* In-flight warning */}
          {showInFlightWarning && (
            <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
              <p className="font-medium">In-flight tool will be cancelled</p>
              <p className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-mono">
                  {idempotencyLabel(inFlight)}
                </Badge>
                <span>
                  The latest checkpoint captured a tool mid-flight. Rewinding
                  will cancel it.
                </span>
              </p>
            </div>
          )}

          {/* Type-to-confirm */}
          <div className="space-y-1.5">
            <Label htmlFor="rewind-mission-id" className="text-xs">
              Type the mission ID to confirm
            </Label>
            <Input
              id="rewind-mission-id"
              value={typedId}
              onChange={(e) => setTypedId(e.target.value)}
              placeholder={missionId}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-xs"
              aria-invalid={typedId.length > 0 && !idMatches}
            />
            <p className="text-[10px] text-muted-foreground">
              Expected: <span className="font-mono">{missionId}</span>
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!idMatches || submitting}
            onClick={() => void handleConfirm()}
          >
            {submitting ? "Rewinding..." : "Rewind to here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
