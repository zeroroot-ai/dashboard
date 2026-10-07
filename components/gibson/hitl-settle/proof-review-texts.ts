// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The visible text of the proof review section (dashboard#228). The owner
 * has not approved these strings yet. They are on the approval list in
 * release/final-session.md of the docs repository. Change them only there.
 */
export const PROOF_REVIEW_TEXTS = {
  heading: "Proofs that wait for a review",
  description:
    "An agent sent these proofs with evidence that it typed. The platform cannot check that evidence. Read the evidence, then settle the bet.",
  loadError: "We could not load the proofs",
  emptyTitle: "No proof waits for a review",
  emptyDescription: "A proof shows here when an agent sends evidence that the platform cannot check.",
  technique: "Technique",
  mission: "Mission",
  submitted: "Received",
  evidence: "Evidence",
  noEvidence: "The proof holds no evidence.",
  showMore: "Show more proofs",
} as const;
