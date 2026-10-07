// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The proofs that wait for a human review (dashboard#228, gibson#798,
 * ADR-0131).
 *
 * A proof that carries only evidence the agent typed settles nothing. The
 * daemon records it, and a reviewer reads the evidence here and settles the
 * bet through `WorldService.SettleBetByHITL`. The plain JSON shapes below are
 * what the route maps `WorldService.ListProofReviews` into. The hook and the
 * component read them, never the generated proto.
 */

/** One item of evidence as the agent typed it. */
export interface ProofEvidenceItem {
  type: string;
  title: string;
  /** Redacted by the flight recorder policy of the tenant. */
  content: string;
}

/** One proof that waits for a review. */
export interface ProofReviewItem {
  /** The bet that a verdict settles. */
  hypothesisId: string;
  missionId: string;
  scopeId: string;
  technique: string;
  evidence: ProofEvidenceItem[];
  /** The time the daemon received the proof, as an ISO 8601 string. Empty when unknown. */
  submittedAt: string;
}

/** Response body for `GET /api/world/proof-reviews`. */
export interface ProofReviewPage {
  items: ProofReviewItem[];
  /** Empty on the last page. */
  nextPageToken: string;
}
