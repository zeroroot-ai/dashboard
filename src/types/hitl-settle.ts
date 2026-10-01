// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * HITL settle surface types (ADR-0023, ADR-0006, gibson#264/#266/#280,
 * dashboard#97).
 *
 * A human judges an OPEN bet the fleet is unsure about — true-positive,
 * false-positive, or dismiss — and the verdict settles the bet
 * (`WorldService.SettleBetByHITL`) and feeds `braintrain`. This is distinct
 * from the destructive-action authorization queue (dashboard#99, ADR-0028),
 * which asks "may this dangerous action run at all", and from the
 * finding/surprise review queue (`/api/world/review`, ADR-0006), which labels
 * surfaced surprises. Bets are a different domain object (gibson#339) even
 * though the verdict vocabulary matches.
 *
 * These are the plain, over-the-wire JSON shapes the route maps the generated
 * `OpenBet` / `SettleBetByHITLResponse` messages into; the hook and the
 * component read them, never the generated proto. `SettleBetByHITL` accepts
 * all three verdicts: true_positive / false_positive settle the bet, dismiss
 * applies a label only and never settles it (the daemon's own rule).
 */

/**
 * One piece of evidence backing a bet's claim: the entity the claim references,
 * by taxonomy label and identity properties (the same by-label-and-properties
 * addressing the bet carries on the wire, sdk#70).
 */
export interface BetEvidenceItem {
  /** Taxonomy label of the referenced entity (e.g. "Host", "Port"). */
  label: string;
  /** Identity properties of the referenced entity (e.g. { address: "10.0.0.5" }). */
  idProperties: Record<string, string>;
}

/** An OPEN bet awaiting a human verdict. */
export interface OpenBetForReview {
  /** Identity for the verdict write-back (the bet's HypothesisID). */
  id: string;
  hypothesisId: string;
  /** The hypothesis's claim text — what the fleet believes is true. */
  claim: string;
  /** The agent that staked this bet. */
  proposer: string;
  /** The claim's self-reported confidence, [0,1]. */
  confidence: number;
  /** The entities the claim is about. */
  evidence: BetEvidenceItem[];
  /**
   * The AgentRun that proposed this bet, so the UI can link to its recorded
   * transcript via the Gibson Traces surface (gibson#755). Empty when the
   * observation carried no run id.
   */
  runId: string;
}

/** A human's verdict on one open bet. */
export type BetVerdict = 'true_positive' | 'false_positive' | 'dismiss';

/** Response body for `GET /api/world/bet-settlements`. */
export interface HitlSettleQueueResponse {
  items: OpenBetForReview[];
}

/** Response body for `POST /api/world/bet-settlements`. */
export interface HitlSettleVerdictResponse {
  ok: true;
  /** Confirms the recorded verdict. */
  settled: BetVerdict;
  /**
   * Whether this verdict actually settled the bet (true_positive/
   * false_positive) or only recorded a label without settling (dismiss, or a
   * bet already settled by another path).
   */
  didSettle: boolean;
  /** Human-readable confirmation of the effect, for the UI to surface. */
  effect: string;
}
