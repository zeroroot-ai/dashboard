"use client";

/**
 * CheckpointBadge, "Resumed from checkpoint X" affordance.
 *
 * Reads {@link CheckpointMetadata} streamed back on the first
 * `ResumeMissionResponse` event. When metadata is null the badge
 * surfaces "Resumed from scratch (no checkpoint found)" verbatim,
 * matching Spec mission-checkpointing R9.3.
 *
 * Tooltip exposes the full checkpoint id, super-step, and cadence
 * reason so operators can trace the resume back to a saved state
 * without leaving the mission detail page.
 *
 * Spec: week-4-handlers-ui-e2e §4 task 42.
 */

import * as React from "react";
import { HistoryIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import type { CheckpointMetadata } from "@/src/gen/gibson/daemon/v1/daemon_pb";

function checkpointShortId(id: string): string {
  return id.length > 8 ? id.slice(-8) : id;
}

function timeAgoFromUnixSeconds(unixSec: bigint): string {
  if (unixSec === BigInt(0)) return "-";
  const seconds = Math.max(
    0,
    Math.floor(Date.now() / 1000) - Number(unixSec),
  );
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface CheckpointBadgeProps {
  /** Metadata from `ResumeMissionResponse.checkpoint_metadata`, or null. */
  checkpointMetadata: CheckpointMetadata | null;
}

export function CheckpointBadge({ checkpointMetadata }: CheckpointBadgeProps) {
  if (!checkpointMetadata) {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 font-mono text-xs text-muted-foreground"
      >
        <HistoryIcon className="size-3" aria-hidden />
        Resumed from scratch (no checkpoint found)
      </Badge>
    );
  }

  const shortId = checkpointShortId(checkpointMetadata.checkpointId);
  const ago = timeAgoFromUnixSeconds(checkpointMetadata.savedAtUnixSeconds);
  const cadence = checkpointMetadata.cadenceReason || "unspecified";
  const superStep = checkpointMetadata.superStepNumber;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="gap-1.5 font-mono text-xs"
            aria-label={`Resumed from checkpoint ${shortId} saved ${ago}`}
          >
            <HistoryIcon className="size-3" aria-hidden />
            Resumed from checkpoint {shortId} (saved {ago})
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-sm">
          <div className="space-y-0.5 text-xs">
            <p>
              <span className="text-muted-foreground">id: </span>
              <span className="font-mono">
                {checkpointMetadata.checkpointId}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">super-step: </span>
              <span className="font-mono">{superStep}</span>
            </p>
            <p>
              <span className="text-muted-foreground">cadence: </span>
              <span className="font-mono">{cadence}</span>
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
