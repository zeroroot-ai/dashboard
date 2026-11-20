// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The items that wait on a person (epic gibson#1497, panel 4).
 *
 * The source is WorldService.ListWaitingOnPerson (gibson#1500). It returns four
 * kinds of items: a destructive action, a refused merge, a wait on the next
 * scan, and a missing health signal. A destructive action also takes its
 * technique, its blast radius and its reversibility from the queue of pending
 * destructive actions, matched by the id of the hypothesis. The API gives no
 * place where a person acts, so a finding item links to the page of the finding.
 *
 * The Review Queue and the Settle Queue are not wait items. No agent waits
 * on them (ADR-0108).
 */

import type {
  DestructiveReversibility,
  PendingDestructiveAction,
} from "@/src/types/destructive-actions";

/** One item as the route /api/world/waiting returns it. */
export interface WaitingItemDto {
  /** destructive_action, merge_refused, next_scan or no_health_signal. */
  kind: string;
  /** The id of the finding, or of the hypothesis for a destructive action. */
  id: string;
  /** ISO time when the wait started. Empty when the daemon sends none. */
  since: string;
  waitedSeconds: number;
}

interface WaitItemBase {
  /** Stable id. The kind and the source id together are unique. */
  id: string;
  /** What waits, in one line. */
  title: string;
  /** Epoch milliseconds when the wait started. Null when the source gives no time. */
  waitStartedAtMs: number | null;
  /** The one place where a person acts. */
  href: string;
}

/** A destructive action with no decision. */
export interface DestructiveActionWaitItem extends WaitItemBase {
  kind: "destructive-action";
  /** Empty when the daemon gives no description. */
  blastRadius: string;
  reversibility: DestructiveReversibility;
}

/** A finding in `fixing` whose merge the branch protection refused. */
interface MergeRefusedWaitItem extends WaitItemBase {
  kind: "merge-refused";
}

/** A `fixed` finding that waits on the next scan of the tool of the buyer. */
interface AwaitingScanWaitItem extends WaitItemBase {
  kind: "awaiting-scan";
}

/** A `fixed` finding of a service with no health signal. */
interface NoHealthSignalWaitItem extends WaitItemBase {
  kind: "no-health-signal";
}

export type WaitItem =
  | DestructiveActionWaitItem
  | MergeRefusedWaitItem
  | AwaitingScanWaitItem
  | NoHealthSignalWaitItem;

/** The page where a person decides a destructive action. */
const DESTRUCTIVE_ACTIONS_HREF = "/dashboard/destructive-actions";

const FINDING_KINDS = {
  merge_refused: "merge-refused",
  next_scan: "awaiting-scan",
  no_health_signal: "no-health-signal",
} as const;

function startMs(since: string): number | null {
  const t = since ? new Date(since).getTime() : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/**
 * Make the wait items of the API reply. An item of a kind that this code does
 * not know is dropped. The queue of destructive actions adds the details of a
 * destructive action. An action that is not in the queue shows its id, a blast
 * radius that is not stated and a reversibility that is not classified.
 */
export function waitItemsFromApi(
  items: readonly WaitingItemDto[],
  destructive: readonly PendingDestructiveAction[],
): WaitItem[] {
  const byHypothesis = new Map(destructive.map((a) => [a.hypothesisId || a.id, a]));
  const out: WaitItem[] = [];
  for (const it of items) {
    const waitStartedAtMs = startMs(it.since);
    if (it.kind === "destructive_action") {
      const action = byHypothesis.get(it.id);
      out.push({
        kind: "destructive-action",
        id: `destructive-action:${it.id}`,
        title: action?.technique || it.id,
        waitStartedAtMs,
        href: DESTRUCTIVE_ACTIONS_HREF,
        blastRadius: action?.blastRadius ?? "",
        reversibility: action?.reversibility ?? "unspecified",
      });
      continue;
    }
    if (it.kind === "merge_refused" || it.kind === "next_scan" || it.kind === "no_health_signal") {
      out.push({
        kind: FINDING_KINDS[it.kind],
        id: `${FINDING_KINDS[it.kind]}:${it.id}`,
        title: it.id,
        waitStartedAtMs,
        href: `/dashboard/findings/${encodeURIComponent(it.id)}`,
      });
    }
  }
  return out;
}

/** The wait of an item in milliseconds. Null when the start is unknown. Never negative. */
export function waitMs(item: WaitItem, nowMs: number): number | null {
  if (item.waitStartedAtMs === null) return null;
  return Math.max(0, nowMs - item.waitStartedAtMs);
}

/** Longest wait first. An item with an unknown wait comes last. */
export function sortByLongestWait(items: readonly WaitItem[], nowMs: number): WaitItem[] {
  return [...items].sort((a, b) => {
    const wa = waitMs(a, nowMs);
    const wb = waitMs(b, nowMs);
    if (wa === null && wb === null) return 0;
    if (wa === null) return 1;
    if (wb === null) return -1;
    return wb - wa;
  });
}

export interface WaitSummary {
  count: number;
  /** The wait of the oldest item. Null when no item has a known wait. */
  oldestMs: number | null;
}

export function summarizeWaits(items: readonly WaitItem[], nowMs: number): WaitSummary {
  let oldest: number | null = null;
  for (const item of items) {
    const w = waitMs(item, nowMs);
    if (w !== null && (oldest === null || w > oldest)) oldest = w;
  }
  return { count: items.length, oldestMs: oldest };
}

/** A duration as days, hours and minutes. Two units at most. */
export function formatWait(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "less than 1 minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}
