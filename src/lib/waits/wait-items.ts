// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The items that wait on a person (epic gibson#1497, panel 4).
 *
 * The tenant API of gibson#1500 returns four kinds of items. Only the first
 * kind has a source today: the pending destructive actions. The other three
 * kinds are in the type, so the API can fill them with no change to the
 * panel. No code here makes an item of those kinds.
 *
 * The Review Queue and the Settle Queue are not wait items. No agent waits
 * on them (ADR-0108).
 */

import type {
  DestructiveReversibility,
  PendingDestructiveAction,
} from "@/src/types/destructive-actions";

/** The four kinds of items that add wait time. */
type WaitItemKind =
  | "destructive-action"
  | "merge-refused"
  | "awaiting-scan"
  | "no-health-signal";

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

/** Make the wait items of the pending destructive actions. */
export function waitItemsFromDestructiveActions(
  actions: readonly PendingDestructiveAction[],
): DestructiveActionWaitItem[] {
  return actions.map((a) => {
    const started = a.requestedAt ? new Date(a.requestedAt).getTime() : Number.NaN;
    return {
      kind: "destructive-action",
      id: `destructive-action:${a.id}`,
      title: a.technique,
      waitStartedAtMs: Number.isFinite(started) ? started : null,
      href: DESTRUCTIVE_ACTIONS_HREF,
      blastRadius: a.blastRadius,
      reversibility: a.reversibility,
    };
  });
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
