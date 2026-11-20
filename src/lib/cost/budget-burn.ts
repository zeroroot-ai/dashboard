// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The budget burn and the cost of a verified fix (dashboard#394).
 *
 * The budget burn comes from BudgetStatus. The cost of a verified fix needs
 * the status of each finding and the model cost of each finding. The backend
 * returns neither together yet, so `FixCost` is the typed input that the
 * backend call will fill. A cost that is not known is `null`. It is never
 * zero.
 */

/** One budget status row, in the shape of `BudgetStatusRow`. */
export interface BudgetStatusInput {
  currentSpendUsdCents: number;
  /** Zero means no spend limit. */
  spendLimitUsdCents: number;
  /** Unix seconds. */
  periodResetAtUnix: number;
  warningCrossed: boolean;
}

export interface BudgetBurn {
  spentUsdCents: number;
  /** Null when the budget has no spend limit. */
  limitUsdCents: number | null;
  /** The spent share of the limit, from 0 to 1. Null when there is no limit. */
  fraction: number | null;
  /** The warning threshold of the budget is crossed. */
  warningCrossed: boolean;
  /** The spend reached the limit. */
  limitReached: boolean;
  /** Epoch milliseconds when the period resets. Null when the daemon gives no time. */
  resetAtMs: number | null;
}

export function summarizeBudget(row: BudgetStatusInput): BudgetBurn {
  const limit = row.spendLimitUsdCents > 0 ? row.spendLimitUsdCents : null;
  return {
    spentUsdCents: row.currentSpendUsdCents,
    limitUsdCents: limit,
    fraction: limit === null ? null : Math.min(1, row.currentSpendUsdCents / limit),
    warningCrossed: row.warningCrossed,
    limitReached: limit !== null && row.currentSpendUsdCents >= limit,
    resetAtMs: row.periodResetAtUnix > 0 ? row.periodResetAtUnix * 1000 : null,
  };
}

/** A whole-cent amount as dollars. */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The model cost of one `verified` finding. A null cost is unknown. */
export interface FixCost {
  findingId: string;
  costUsdCents: number | null;
}

export type MedianFixCost =
  | { known: false }
  | { known: true; medianUsdCents: number; verifiedCount: number; unknownCount: number };

/**
 * The median cost of a verified fix. A finding with an unknown cost stays out
 * of the median and is counted apart. When no finding has a known cost, the
 * median is unknown.
 */
export function medianFixCost(fixes: readonly FixCost[]): MedianFixCost {
  const known = fixes
    .map((f) => f.costUsdCents)
    .filter((c): c is number => c !== null && Number.isFinite(c) && c >= 0)
    .sort((a, b) => a - b);
  if (known.length === 0) return { known: false };
  const mid = Math.floor(known.length / 2);
  const median = known.length % 2 === 1 ? known[mid] : Math.round((known[mid - 1] + known[mid]) / 2);
  return {
    known: true,
    medianUsdCents: median,
    verifiedCount: known.length,
    unknownCount: fixes.length - known.length,
  };
}
