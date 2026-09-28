// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * HITL settle surface types (ADR-0023, ADR-0006, gibson#264/#266/#280,
 * dashboard#97).
 *
 * A human judges an OPEN bet the fleet is unsure about — true-positive,
 * false-positive, or dismiss — and the verdict settles the bet
 * (`SettleBetByHITL`, gibson#280) and feeds `braintrain`. This is distinct
 * from the destructive-action authorization queue (dashboard#99, ADR-0028):
 * that surface asks "may this dangerous action run at all", this surface
 * asks "was the fleet's claim correct". It is also distinct from the
 * finding/surprise review queue (`/api/world/review`, ADR-0006) — bets are
 * a different domain object (gibson#265/#273) even though the verdict
 * vocabulary (true_positive/false_positive/dismiss) matches.
 *
 * "The proposing agent's transcript" reuses the already-merged Gibson Traces
 * surface (gibson#755, `useCallTranscript`/`useRunDetail` in
 * src/hooks/useTraces.ts) via the bet's `runId`, when known.
 *
 * KNOWN UPSTREAM GAPS (confirmed against gibson `internal/engine/brain/
 * bet_settlement.go` + `hypothesis.go` on origin/epic/intelligence-layer;
 * see src/lib/hitl-settle/client.ts for the wire-level consequence). None of
 * these block building this UI against a typed stub, but they DO mean the
 * fields below cannot be filled from real data until a gibson-side follow-up
 * lands:
 *
 *   1. No gRPC/REST surface exists for bets/hypotheses AT ALL (gibson#280
 *      only merged the Go-internal `Engine.SettleBetByHITL` + a
 *      `LabelApplied{TargetID:"bet-"+HypothesisID}` event — no RPC calls it
 *      in production).
 *   2. "OPEN" is not a real status field; it must be derived as "a
 *      Hypothesis with no matching BetSettlement" — but `Hypothesis.ID` is a
 *      `uint64` while `BetSettlement.HypothesisID` is a `string` (the bet's
 *      own externally-given id), and gibson's own code comments call this
 *      an unreconciled join gap, not a guaranteed match.
 *   3. `Hypothesis` carries no `RunID`, so `runId` below cannot be filled
 *      precisely yet (only `Proposer` (agent name) + `ScopeID`, which is
 *      ambiguous if the same agent proposes more than once in a scope).
 *   4. No evidence is persisted for a bet awaiting HITL judgment — only a
 *      sha256 digest is kept once a PREDICATE settlement happens, and that's
 *      a different settlement path. `evidence` below is a proposed shape
 *      (loosely modeled on `finding.EnhancedEvidence`), not read from
 *      anywhere real today.
 *   5. `SettleBetByHITL` REFUSES `VerdictDismiss` outright (only
 *      true_positive/false_positive settle a bet). A "dismiss" verdict here
 *      is modeled as label-only (no settlement) — see client.ts.
 *   6. No belief/reputation-update event exists yet (tracked loosely as
 *      gibson#267/#277). The "effect" surfaced after a verdict is an honest
 *      acknowledgement, not a live number.
 */

/** One piece of evidence backing a bet's claim. */
export interface BetEvidenceItem {
  /** Human-readable description of what was observed. */
  description: string;
  /** Structured evidence payload, shape varies by technique. */
  data?: unknown;
}

/** An OPEN bet awaiting a human verdict. */
export interface OpenBetForReview {
  /** Identity for the verdict write-back (the bet's HypothesisID string). */
  id: string;
  missionId: string;
  scopeId: string;
  hypothesisId: string;
  /** The hypothesis's claim text — what the fleet believes is true. */
  claim: string;
  /** The agent that staked this bet. */
  proposer: string;
  /** The agent's stated confidence, [0,1]. */
  confidence: number;
  /** The settlement technique the bet would be proven/disproven by. */
  technique: string;
  evidence: BetEvidenceItem[];
  /**
   * The AgentRun that proposed this bet, so the UI can link to its recorded
   * transcript via the Gibson Traces surface (gibson#755). Empty when no run
   * is linked (see gap #3 above — this is the common case today).
   */
  runId: string;
  requestedAt: string;
}

/** A human's verdict on one open bet. */
export type BetVerdict = 'true_positive' | 'false_positive' | 'dismiss';

/** Response body for `GET /api/world/bet-settlements`. */
export interface HitlSettleQueueResponse {
  items: OpenBetForReview[];
  /**
   * False when gibson's HITL settlement backend is not queryable yet. The
   * queue is legitimately empty in that case, not broken.
   */
  available: boolean;
}

/** Response body for `POST /api/world/bet-settlements`. */
export interface HitlSettleVerdictResponse {
  ok: true;
  /** Confirms the recorded verdict. */
  settled: BetVerdict;
  /**
   * Whether this verdict actually settled the bet (true_positive/
   * false_positive via SettleBetByHITL) or only recorded a label without
   * settling (dismiss — SettleBetByHITL refuses it; see gap #5 above).
   */
  didSettle: boolean;
  /** Human-readable confirmation of the effect, for the UI to surface. */
  effect: string;
}
