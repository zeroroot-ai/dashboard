// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Reliability / calibration report types (ADR-0122, gibson#284, dashboard#98).
 *
 * A reliability diagram answers one question: when the fleet says a bet is 80%
 * likely, does it come true 80% of the time? The daemon computes this from
 * settled, staked bets (`WorldService.GetCalibration`) — a tenant-wide summary
 * plus a per-technique breakdown, each carrying a Brier score and a binned
 * reliability curve (predicted probability vs. observed frequency). These view
 * types are the plain, over-the-wire JSON shape the route maps the proto into;
 * the chart reads them, never the generated proto message.
 *
 * The seam has no time dimension: `GetCalibrationRequest` carries only `bins`
 * (the curve's resolution), so the dashboard filters by technique and by bin
 * resolution. A time-range filter waits on a gibson-side field.
 */

/** One predicted-probability bucket of the reliability curve. */
export interface CalibrationBin {
  /** Inclusive lower edge of the bucket's predicted-probability range [0,1]. */
  low: number;
  /** Exclusive upper edge of the bucket's predicted-probability range [0,1]. */
  high: number;
  /** How many settled bets fell in this bucket. */
  n: number;
  /** Mean predicted probability across the bucket's bets — the point's x. */
  meanPredicted: number;
  /** Observed frequency of a TRUE verdict in the bucket — the point's y. */
  observedFrequency: number;
}

/**
 * One group of settled bets: the tenant-wide summary (`technique` is "") or a
 * single technique's bets.
 */
export interface TechniqueCalibration {
  /** The settlement technique, or "" for the tenant-wide summary. */
  technique: string;
  /** Total settled, staked bets in this group. */
  n: number;
  /** Mean predicted probability across every bet in the group. */
  meanPredicted: number;
  /** Observed frequency of a TRUE verdict across the group. */
  observedFrequency: number;
  /** Mean squared error of prediction vs. outcome; 0 is perfect, lower is better. */
  brierScore: number;
  /** The reliability curve, one point per predicted-probability bucket. */
  bins: CalibrationBin[];
}

/** The tenant's full reliability report, the body of GET /api/world/calibration. */
export interface CalibrationReport {
  /** The resolved tenant the report is for. */
  tenant: string;
  /** The tenant-wide summary across every technique, or null when no bet settled. */
  overall: TechniqueCalibration | null;
  /** Per-technique breakdown, one entry per technique with settled bets. */
  byTechnique: TechniqueCalibration[];
  /**
   * Settled bets that were never staked (no recorded belief), so calibration
   * cannot score them. Surfaced, not hidden.
   */
  unscored: number;
  /** The bin resolution this report was computed at (the echoed request value). */
  bins: number;
}

/**
 * The track record of one technique in one scope (ADR-0129 §3, gibson#619,
 * dashboard#192), from WorldService.GetReputation.
 */
export interface TrackRecord {
  technique: string;
  scopeId: string;
  /**
   * The confidence a new hypothesis of this technique starts from in this
   * scope: the observed TRUE frequency once bets settled, or the neutral
   * prior when hasTrackRecord is false.
   */
  priorStrength: number;
  /** False when no bet of this technique has settled in this scope. */
  hasTrackRecord: boolean;
}

/**
 * One technique a mission used, in the scope the mission used it in: the
 * technique and the scope of one hypothesis of the mission (dashboard#192).
 */
export interface MissionTechnique {
  technique: string;
  scopeId: string;
}

/** The techniques of one mission, from /api/missions/:id/techniques. */
export interface MissionTechniques {
  techniques: MissionTechnique[];
  /** True when the World holds more hypotheses than one read returns. */
  truncated: boolean;
}
