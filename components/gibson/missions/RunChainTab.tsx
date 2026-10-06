// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * RunChainTab — the runs of a mission as a chain, the checkpoints of this
 * run, and the rewind action (dashboard#227, ADR-0170).
 *
 * A rewind starts a new run from a checkpoint. It deletes nothing. The new
 * run names its parent run and the checkpoint, and this tab shows that link.
 * Whoever may run the mission may rewind it; a user who may not sees no
 * button and no message about it. The owner approved the page text on
 * 2026-10-05; dashboard#227 holds it word for word.
 */

import * as React from "react";
import Link from "next/link";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import {
  getMissionCheckpointsAction,
  listMissionRunsAction,
  rewindMissionAction,
  type CheckpointView,
  type MissionRunView,
} from "@/app/actions/missions/runs";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

const REWIND_METHOD = "/gibson.daemon.v1.DaemonService/RewindMission";

interface RunChainTabProps {
  /** The run on this page. */
  missionId: string;
  /** The mission name, which keys the run history. */
  missionName: string;
}

/** "Run 2, from Run 1 at checkpoint "scan"" or "Run 1". */
function runLabel(
  run: MissionRunView,
  runsById: ReadonlyMap<string, MissionRunView>,
  nodeOfCheckpoint: (missionId: string, checkpointId: string) => string | undefined,
): string {
  const parent = run.parentMissionId ? runsById.get(run.parentMissionId) : undefined;
  if (!parent) return `Run ${run.runNumber}`;
  const node = nodeOfCheckpoint(parent.missionId, run.parentCheckpointId) ?? run.parentCheckpointId;
  return `Run ${run.runNumber}, from Run ${parent.runNumber} at checkpoint "${node}"`;
}

function endedAt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function RunChainTab({ missionId, missionName }: RunChainTabProps) {
  const { allowed: canRewind, loading: rewindAuthLoading } = useAuthorize(REWIND_METHOD);
  const showRewind = !rewindAuthLoading && canRewind;

  const runsQuery = useQuery({
    queryKey: ["mission-runs", missionName],
    queryFn: () => listMissionRunsAction(missionName),
    enabled: missionName !== "",
  });
  const checkpointsQuery = useQuery({
    queryKey: ["mission-checkpoints", missionId],
    queryFn: () => getMissionCheckpointsAction(missionId),
  });

  const runs = React.useMemo(
    () => (runsQuery.data?.ok ? runsQuery.data.data : []),
    [runsQuery.data],
  );
  const runsById = React.useMemo(
    () => new Map(runs.map((r) => [r.missionId, r])),
    [runs],
  );

  // The checkpoints of each parent run name the node of each rewind.
  const parentIds = React.useMemo(
    () => [...new Set(runs.map((r) => r.parentMissionId).filter((id) => id !== ""))],
    [runs],
  );
  const parentCheckpoints = useQueries({
    queries: parentIds.map((id) => ({
      queryKey: ["mission-checkpoints", id],
      queryFn: () => getMissionCheckpointsAction(id),
    })),
  });
  const nodeOfCheckpoint = React.useCallback(
    (runId: string, checkpointId: string): string | undefined => {
      const index = parentIds.indexOf(runId);
      const result = index >= 0 ? parentCheckpoints[index]?.data : undefined;
      if (!result?.ok) return undefined;
      return result.data.find((c) => c.checkpointId === checkpointId)?.nodeId;
    },
    [parentIds, parentCheckpoints],
  );

  const thisRun = runsById.get(missionId);
  const [rewindTarget, setRewindTarget] = React.useState<CheckpointView | null>(null);

  return (
    <div className="space-y-4">
      <Card data-testid="run-chain">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Runs
          </CardTitle>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <TableSkeleton rows={2} />
          ) : runsQuery.data && !runsQuery.data.ok ? (
            <ErrorAlert title="The runs did not load." error={{ message: runsQuery.data.error }} />
          ) : runs.length <= 1 ? (
            <p className="text-sm text-muted-foreground">This mission has one run.</p>
          ) : (
            <ol className="space-y-1 text-sm font-mono">
              {runs.map((run) => (
                <li key={run.missionId} data-testid="run-chain-run" data-current={run.missionId === missionId}>
                  {run.missionId === missionId ? (
                    <span className="font-semibold">{runLabel(run, runsById, nodeOfCheckpoint)}</span>
                  ) : (
                    <Link
                      href={`/dashboard/results/${encodeURIComponent(run.missionId)}`}
                      className="underline-offset-2 hover:underline"
                    >
                      {runLabel(run, runsById, nodeOfCheckpoint)}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card data-testid="run-checkpoints">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
            Checkpoints
          </CardTitle>
        </CardHeader>
        <CardContent>
          {checkpointsQuery.isLoading ? (
            <TableSkeleton rows={3} />
          ) : checkpointsQuery.data && !checkpointsQuery.data.ok ? (
            <ErrorAlert
              title="The checkpoints did not load."
              error={{ message: checkpointsQuery.data.error }}
            />
          ) : (
            <ul className="space-y-3">
              {(checkpointsQuery.data?.ok ? checkpointsQuery.data.data : []).map((cp) => (
                <li
                  key={cp.checkpointId}
                  className="flex flex-wrap items-start justify-between gap-2"
                  data-testid="checkpoint"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-mono">
                      {cp.nodeId}, ended {endedAt(cp.endedAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {cp.hasSnapshot
                        ? "Sandbox state saved"
                        : "Sandbox state not saved. A rewind starts this node with a clean sandbox."}
                    </p>
                  </div>
                  {showRewind ? (
                    <Button size="sm" variant="outline" onClick={() => setRewindTarget(cp)}>
                      Rewind to here
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {showRewind && rewindTarget ? (
        <RewindDialog
          missionId={missionId}
          missionName={missionName}
          runNumber={thisRun?.runNumber}
          checkpoint={rewindTarget}
          onClose={() => setRewindTarget(null)}
        />
      ) : null}
    </div>
  );
}

function RewindDialog({
  missionId,
  missionName,
  runNumber,
  checkpoint,
  onClose,
}: {
  missionId: string;
  missionName: string;
  runNumber: number | undefined;
  checkpoint: CheckpointView;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [instruction, setInstruction] = React.useState("");
  const [pending, setPending] = React.useState(false);
  // One key for each opening of the dialog: a retry of the same click
  // starts no second run.
  const [idempotencyKey] = React.useState(() => crypto.randomUUID());
  const fieldId = React.useId();
  const node = checkpoint.nodeId;

  async function start() {
    setPending(true);
    try {
      const result = await rewindMissionAction({
        missionId,
        checkpointId: checkpoint.checkpointId,
        instruction,
        idempotencyKey,
      });
      if (!result.ok) {
        toast.error(`The rewind did not start. ${result.error}`);
        return;
      }
      const runs = await queryClient.fetchQuery({
        queryKey: ["mission-runs", missionName],
        queryFn: () => listMissionRunsAction(missionName),
        staleTime: 0,
      });
      const started = runs.ok
        ? runs.data.find((r) => r.missionId === result.data.missionId)
        : undefined;
      toast.success(started ? `Run ${started.runNumber} started.` : "Run started.");
      onClose();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rewind to &quot;{node}&quot;</DialogTitle>
          <DialogDescription>
            This starts a new run from this checkpoint. It deletes nothing.
            {runNumber !== undefined ? ` Run ${runNumber} stays as it is.` : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={fieldId}>Instruction for &quot;{node}&quot;</Label>
          <Textarea
            id={fieldId}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={pending}
            aria-describedby={`${fieldId}-help`}
          />
          <p id={`${fieldId}-help`} className="text-xs text-muted-foreground">
            You can change the instruction of this node only.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={pending} aria-busy={pending}>
            Start new run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
