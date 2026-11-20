// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The exposure window and the revert rate (gibson#1467, gibson#1468).
 *
 * The daemon computes each number. The dashboard computes none. This file
 * maps the replies to JSON and holds the rules that decide when a number has
 * no meaning, so the panel shows an empty state and never a false zero.
 */

import type {
  GetExposureTrendResponse,
  GetRevertRateResponse,
  RevertPeriod,
} from "@/src/gen/gibson/world/v1/world_pb";

/** One week, in seconds. The panel asks for this period. */
export const EXPOSURE_PERIOD_SECONDS = 7 * 24 * 3600;

export interface ExposureTrend {
  periodSeconds: number;
  /** The number of findings verified in the period. Zero means no median. */
  count: number;
  medianSeconds: number;
  medianAgentSeconds: number;
  medianWaitSeconds: number;
  previousCount: number;
  previousMedianSeconds: number;
}

export interface RevertPeriodView {
  merged: number;
  reverted: number;
  rate: number;
}

export interface RevertRate {
  periodSeconds: number;
  current: RevertPeriodView;
  previous: RevertPeriodView;
}

export interface ExposureSummary {
  exposure: ExposureTrend;
  revert: RevertRate;
}

export function toExposureTrend(r: GetExposureTrendResponse): ExposureTrend {
  return {
    periodSeconds: Number(r.periodSeconds),
    count: r.count,
    medianSeconds: Number(r.medianSeconds),
    medianAgentSeconds: Number(r.medianAgentSeconds),
    medianWaitSeconds: Number(r.medianWaitSeconds),
    previousCount: r.previousCount,
    previousMedianSeconds: Number(r.previousMedianSeconds),
  };
}

function toRevertPeriod(p: RevertPeriod | undefined): RevertPeriodView {
  return { merged: p?.merged ?? 0, reverted: p?.reverted ?? 0, rate: p?.rate ?? 0 };
}

export function toRevertRate(r: GetRevertRateResponse): RevertRate {
  return {
    periodSeconds: Number(r.periodSeconds),
    current: toRevertPeriod(r.current),
    previous: toRevertPeriod(r.previous),
  };
}

export type Direction = "up" | "down" | "same";

/**
 * The change from the previous period to this one. Null when either period
 * has no data, because a change from nothing has no meaning.
 */
export function medianChange(trend: ExposureTrend): { seconds: number; direction: Direction } | null {
  if (trend.count === 0 || trend.previousCount === 0) return null;
  const seconds = trend.medianSeconds - trend.previousMedianSeconds;
  return { seconds, direction: seconds > 0 ? "up" : seconds < 0 ? "down" : "same" };
}

/** The change of the revert rate. Null when either period merged no fix. */
export function revertChange(revert: RevertRate): { points: number; direction: Direction } | null {
  if (revert.current.merged === 0 || revert.previous.merged === 0) return null;
  const points = Math.round((revert.current.rate - revert.previous.rate) * 100);
  return { points, direction: points > 0 ? "up" : points < 0 ? "down" : "same" };
}

/** A duration in seconds as days, hours and minutes. Two units at most. */
export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "less than 1 minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

/** A share from 0 to 1 as a whole percent. */
export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}
