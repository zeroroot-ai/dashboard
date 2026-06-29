"use client";

/**
 * CheckpointTimeline, paginated checkpoint timeline for a mission.
 *
 * Renders one row per `CheckpointSummary` returned by
 * `DaemonService.ListCheckpoints`, newest-first by default. Loads more
 * rows via the response's `nextPageToken` cursor on a "Load more" click.
 * Subscribes to the mission event stream to prepend live checkpoint
 * creations without a full re-fetch (Spec mission-checkpointing R17.7).
 *
 * Selection model: user can select up to two rows (checkboxes); the
 * "Diff selected" CTA opens the {@link CheckpointDiffView}.
 *
 * Per-row actions:
 *   - View: opens {@link CheckpointDetail} side panel.
 *   - Rewind to here: opens {@link CheckpointRewindModal}; gated by FGA
 *     `mission#admin` (the button is rendered disabled with a tooltip
 *     when the user lacks the relation, per R17.8, visibility, not
 *     existence, is the affordance).
 *
 * Spec: week-4-handlers-ui-e2e §4 tasks 35, 41, 43, 44.
 */

import * as React from "react";
import {
  ClockIcon,
  GitBranchIcon,
  HistoryIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useAuthorize } from "@/src/lib/auth/use-authorize";
import {
  listCheckpointsAction,
  type ListCheckpointsActionResult,
} from "@/src/components/mission/checkpoint-actions";
import {
  CheckpointSource,
  type CheckpointSummary,
} from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { ToolIdempotency } from "@/src/gen/gibson/manifest/v1/manifest_pb";

import { CheckpointDetail } from "./CheckpointDetail";
import { CheckpointDiffView } from "./CheckpointDiffView";
import { CheckpointRewindModal } from "./CheckpointRewindModal";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const MAX_SELECTION = 2;

const REWIND_METHOD = "/gibson.daemon.v1.DaemonService/ResumeMission";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sourceLabel(src: CheckpointSource): string {
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

function idempotencyLabel(i: ToolIdempotency): string {
  switch (i) {
    case ToolIdempotency.AT_MOST_ONCE:
      return "at-most-once";
    case ToolIdempotency.AT_LEAST_ONCE:
      return "at-least-once";
    case ToolIdempotency.EXACTLY_ONCE:
      return "exactly-once";
    default:
      return "-";
  }
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GiB`;
}

function timestampToDate(ts?: { seconds: bigint; nanos: number }): Date | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6));
}

function timeAgo(d: Date | null): string {
  if (!d) return "-";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function checkpointShortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

function dedupeAndSort(rows: CheckpointSummary[]): CheckpointSummary[] {
  const byId = new Map<string, CheckpointSummary>();
  for (const r of rows) byId.set(r.checkpointId, r);
  return Array.from(byId.values()).sort((a, b) => {
    const sa = timestampToDate(a.capturedAt)?.getTime() ?? 0;
    const sb = timestampToDate(b.capturedAt)?.getTime() ?? 0;
    return sb - sa; // newest first
  });
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function CheckpointRow({
  checkpoint,
  selected,
  selectionDisabled,
  onSelectChange,
  onView,
  onRewind,
  rewindAllowed,
  rewindLoading,
  isLatest,
}: {
  checkpoint: CheckpointSummary;
  selected: boolean;
  selectionDisabled: boolean;
  onSelectChange: (next: boolean) => void;
  onView: () => void;
  onRewind: () => void;
  rewindAllowed: boolean;
  rewindLoading: boolean;
  isLatest: boolean;
}) {
  const captured = timestampToDate(checkpoint.capturedAt);

  return (
    <li className="relative flex items-start gap-3 border-b border-border/40 py-3 last:border-b-0">
      {/* Timeline indicator */}
      <div className="relative flex size-6 shrink-0 items-center justify-center">
        <span
          className={cn(
            "size-2 rounded-full",
            isLatest ? "bg-primary" : "bg-muted-foreground/40",
          )}
        />
        <span
          aria-hidden
          className="absolute top-6 h-full w-px bg-border/60"
        />
      </div>

      <div className="flex flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
        {/* Selection */}
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selected}
            disabled={!selected && selectionDisabled}
            onCheckedChange={(checked) => onSelectChange(checked === true)}
            aria-label={`Select checkpoint ${checkpointShortId(
              checkpoint.checkpointId,
            )}`}
          />
          <span className="font-mono text-xs text-muted-foreground">
            #{checkpoint.superStep.toString()}
          </span>
        </div>

        {/* ID + source */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="font-mono text-xs font-medium"
              title={checkpoint.checkpointId}
            >
              {checkpointShortId(checkpoint.checkpointId)}
            </span>
            <Badge
              variant="outline"
              className="h-5 px-1.5 text-[10px] font-mono"
            >
              {sourceLabel(checkpoint.source)}
            </Badge>
            {checkpoint.parallelGroupId && (
              <Badge
                variant="secondary"
                className="h-5 px-1.5 text-[10px] font-mono"
                title={`Parallel group ${checkpoint.parallelGroupId}`}
              >
                <GitBranchIcon className="mr-1 size-3" aria-hidden />
                {checkpointShortId(checkpoint.parallelGroupId)}
              </Badge>
            )}
            {checkpoint.inFlightIdempotency !==
              ToolIdempotency.UNSPECIFIED && (
              <Badge
                variant="outline"
                className="h-5 px-1.5 text-[10px] font-mono"
                title="Tool was in flight at checkpoint time"
              >
                {idempotencyLabel(checkpoint.inFlightIdempotency)}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ClockIcon className="size-3" aria-hidden />
            <span title={captured?.toISOString() ?? ""}>
              {timeAgo(captured)}
            </span>
            <span className="font-mono">{formatBytes(checkpoint.sizeBytes)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={onView}>
            View
          </Button>
          <RewindButton
            isLatest={isLatest}
            allowed={rewindAllowed}
            loading={rewindLoading}
            onClick={onRewind}
          />
        </div>
      </div>
    </li>
  );
}

function RewindButton({
  isLatest,
  allowed,
  loading,
  onClick,
}: {
  isLatest: boolean;
  allowed: boolean;
  loading: boolean;
  onClick: () => void;
}) {
  // The latest checkpoint cannot be rewound to (it's the current state).
  if (isLatest) return null;

  if (loading) {
    return (
      <Button size="sm" variant="outline" disabled>
        <Skeleton className="h-4 w-16" />
      </Button>
    );
  }

  const button = (
    <Button
      size="sm"
      variant="outline"
      disabled={!allowed}
      onClick={onClick}
      className="gap-1.5"
    >
      <HistoryIcon className="size-3.5" aria-hidden />
      Rewind to here
    </Button>
  );

  if (!allowed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>
            <span className="flex items-center gap-1.5 text-xs">
              <ShieldAlertIcon className="size-3" aria-hidden />
              Missing mission#admin permission
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface CheckpointTimelineProps {
  missionId: string;
}

export function CheckpointTimeline({
  missionId,
}: CheckpointTimelineProps) {
  const [rows, setRows] = React.useState<CheckpointSummary[]>([]);
  const [pageToken, setPageToken] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [rewindTarget, setRewindTarget] = React.useState<
    CheckpointSummary | null
  >(null);
  const [diffOpen, setDiffOpen] = React.useState(false);

  // Spec R17.8: Rewind is gated by mission#admin via the registered RPC.
  const rewindAuth = useAuthorize(REWIND_METHOD);

  const handleResult = React.useCallback(
    (result: ListCheckpointsActionResult, append: boolean) => {
      if (!result.ok) {
        setErrorMessage(result.message);
        toast.error(`Failed to load checkpoints: ${result.message}`, {
          description: result.codeName,
        });
        return;
      }
      setErrorMessage(null);
      setPageToken(result.response.nextPageToken);
      setRows((prev) => {
        const merged = append
          ? [...prev, ...result.response.checkpoints]
          : result.response.checkpoints;
        return dedupeAndSort(merged);
      });
    },
    [],
  );

  const loadFirstPage = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await listCheckpointsAction({
        missionId,
        pageSize: PAGE_SIZE,
        order: "newest_first",
      });
      handleResult(result, false);
    } finally {
      setLoading(false);
    }
  }, [missionId, handleResult]);

  const loadMore = React.useCallback(async () => {
    if (!pageToken) return;
    setLoadingMore(true);
    try {
      const result = await listCheckpointsAction({
        missionId,
        pageSize: PAGE_SIZE,
        pageToken,
        order: "newest_first",
      });
      handleResult(result, true);
    } finally {
      setLoadingMore(false);
    }
  }, [missionId, pageToken, handleResult]);

  React.useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // ---- SSE: live checkpoint events. Spec R17.7. ----
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    let cancelled = false;
    const url = `/api/missions/${encodeURIComponent(missionId)}/events`;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      // The mission event stream may not be wired in every environment.
      return;
    }

    const onCheckpoint = (ev: MessageEvent) => {
      if (cancelled) return;
      try {
        const summary = JSON.parse(ev.data) as Partial<CheckpointSummary> & {
          checkpointId?: string;
          missionId?: string;
        };
        if (!summary?.checkpointId) return;
        setRows((prev) => {
          if (prev.some((r) => r.checkpointId === summary.checkpointId)) {
            return prev;
          }
          // Defensive cast, daemon event-stream payloads are encoded
          // by the existing /events endpoint; the dashboard owns the
          // exact shape only loosely here.
          return dedupeAndSort([summary as CheckpointSummary, ...prev]);
        });
      } catch {
        // ignore malformed events; do not log via console.
      }
    };
    es.addEventListener("checkpoint", onCheckpoint);

    return () => {
      cancelled = true;
      es.removeEventListener("checkpoint", onCheckpoint);
      es.close();
    };
  }, [missionId]);

  // ---- Selection helpers ----

  const toggleSelected = (id: string, next: boolean) => {
    setSelected((prev) => {
      if (next) {
        if (prev.includes(id)) return prev;
        if (prev.length >= MAX_SELECTION) return prev;
        return [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  const clearSelection = () => setSelected([]);

  const handleDiffClicked = () => {
    if (selected.length !== 2) return;
    setDiffOpen(true);
  };

  const refresh = () => {
    setSelected([]);
    setDetailId(null);
    setRewindTarget(null);
    void loadFirstPage();
  };

  // ---- Render ----

  if (loading && rows.length === 0) {
    return (
      <div className="space-y-3 py-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded" />
        ))}
      </div>
    );
  }

  if (errorMessage && rows.length === 0) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p className="font-medium">Failed to load checkpoints</p>
        <p className="mt-1 text-xs opacity-80">{errorMessage}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadFirstPage()}
          className="mt-2 gap-1.5 text-xs"
        >
          <RefreshCwIcon className="size-3" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <HistoryIcon className="size-8 text-muted-foreground/50" aria-hidden />
        <p className="text-sm text-muted-foreground">
          No checkpoints have been captured for this mission yet.
        </p>
      </div>
    );
  }

  const latestId = rows[0]?.checkpointId;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {rows.length} checkpoint{rows.length === 1 ? "" : "s"} loaded
          {pageToken ? ", more available" : "."}
        </p>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <>
              <span className="text-xs text-muted-foreground">
                {selected.length} selected
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                className="h-7 text-xs"
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="default"
                disabled={selected.length !== 2}
                onClick={handleDiffClicked}
                className="h-7 gap-1.5 text-xs"
              >
                Diff selected
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            className="h-7 gap-1.5 text-xs"
            aria-label="Refresh checkpoints"
          >
            <RefreshCwIcon className="size-3" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      <ul className="rounded-md border border-border/40 bg-background/40 px-3">
        {rows.map((cp) => (
          <CheckpointRow
            key={cp.checkpointId}
            checkpoint={cp}
            selected={selected.includes(cp.checkpointId)}
            selectionDisabled={selected.length >= MAX_SELECTION}
            onSelectChange={(next) => toggleSelected(cp.checkpointId, next)}
            onView={() => setDetailId(cp.checkpointId)}
            onRewind={() => setRewindTarget(cp)}
            rewindAllowed={rewindAuth.allowed}
            rewindLoading={rewindAuth.loading}
            isLatest={cp.checkpointId === latestId}
          />
        ))}
      </ul>

      {pageToken && (
        <div className="flex justify-center pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            className="gap-1.5"
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {detailId && (
        <CheckpointDetail
          missionId={missionId}
          checkpointId={detailId}
          open={Boolean(detailId)}
          onOpenChange={(open) => {
            if (!open) setDetailId(null);
          }}
        />
      )}

      {diffOpen && selected.length === 2 && (
        <CheckpointDiffView
          missionId={missionId}
          checkpointAId={selected[0]}
          checkpointBId={selected[1]}
          open={diffOpen}
          onOpenChange={(open) => setDiffOpen(open)}
        />
      )}

      {rewindTarget && (
        <CheckpointRewindModal
          missionId={missionId}
          target={rewindTarget}
          discarded={rows.filter((r) => {
            const targetTs =
              timestampToDate(rewindTarget.capturedAt)?.getTime() ?? 0;
            const rowTs = timestampToDate(r.capturedAt)?.getTime() ?? 0;
            return rowTs > targetTs;
          })}
          latest={rows[0] ?? null}
          open={Boolean(rewindTarget)}
          onOpenChange={(open) => {
            if (!open) setRewindTarget(null);
          }}
          onRewound={refresh}
        />
      )}
    </div>
  );
}
