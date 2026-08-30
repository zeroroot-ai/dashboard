/**
 * Ops wall layout rules for the Coding Agent Console (dashboard#1146).
 *
 * Pure functions. The wall fits however many agents run: one agent is one
 * full pane, two to four are halves, up to nine are thirds, up to
 * twenty-five are five columns, and more are six columns with compact tiles.
 */

import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

/** Tile density. Compact tiles are shorter and use a smaller font. */
type WallDensity = "comfortable" | "compact";
export const WALL_DENSITIES: readonly WallDensity[] = ["comfortable", "compact"];

/** Sort order of the tiles. */
export type WallSort = "started" | "name" | "cost";
export const WALL_SORTS: readonly WallSort[] = ["started", "name", "cost"];

/** Column count for a number of running agents. */
export function wallColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  if (count <= 25) return 5;
  return 6;
}

const TILE_HEIGHT: Record<WallDensity, Record<number, number>> = {
  comfortable: { 1: 560, 2: 380, 3: 320, 5: 260, 6: 220 },
  compact: { 1: 420, 2: 300, 3: 250, 5: 200, 6: 170 },
};

/** Fixed tile height in pixels for a column count and density. */
export function tileHeight(columns: number, density: WallDensity): number {
  const table = TILE_HEIGHT[density];
  return table[columns] ?? table[6];
}

/** Terminal font size in pixels for a density. */
export function tileFontSize(density: WallDensity): number {
  return density === "compact" ? 11 : 13;
}

/** Facts the wall knows per run, fed back by each tile from its stream. */
export interface WallTileFacts {
  costUsd?: number;
}

function startedMs(a: RunningAgentView): number {
  const t = new Date(a.startedAt).getTime();
  return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}

function label(a: RunningAgentView): string {
  return (a.agentName || a.runId).toLowerCase();
}

/**
 * Sorts running agents for the wall. `started` puts the oldest run first,
 * `name` sorts by agent name, and `cost` puts the most expensive run first
 * with unknown costs last. Ties fall back to the run id, so the order is
 * stable across renders.
 */
export function sortRunning(
  agents: readonly RunningAgentView[],
  sort: WallSort,
  facts: ReadonlyMap<string, WallTileFacts>,
): RunningAgentView[] {
  const byId = (a: RunningAgentView, b: RunningAgentView) =>
    a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0;
  const cmp: (a: RunningAgentView, b: RunningAgentView) => number =
    sort === "name"
      ? (a, b) => label(a).localeCompare(label(b)) || byId(a, b)
      : sort === "cost"
        ? (a, b) => {
            const ca = facts.get(a.runId)?.costUsd;
            const cb = facts.get(b.runId)?.costUsd;
            if (ca === undefined && cb === undefined) return byId(a, b);
            if (ca === undefined) return 1;
            if (cb === undefined) return -1;
            return cb - ca || byId(a, b);
          }
        : (a, b) => startedMs(a) - startedMs(b) || byId(a, b);
  return [...agents].sort(cmp);
}

/** Returns `value` when it is one of `allowed`, else `fallback`. */
export function pickChoice<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
