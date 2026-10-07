// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";

import { userClient } from "@/src/lib/gibson-client";
import { WorldService } from "@/src/gen/gibson/world/v1/world_pb";
import type { ProofReview } from "@/src/gen/gibson/world/v1/world_pb";
import type { ProofReviewItem, ProofReviewPage } from "@/src/types/proof-review";

/**
 * The proof review list (dashboard#228). It reads
 * `WorldService.ListProofReviews` through the `userClient` transport (Envoy
 * and ext-authz), and maps each proto message into the plain view type. The
 * verdict goes through the HITL settle client, because a verdict on a proof
 * is a verdict on its bet.
 */

/** The page size that the dashboard asks for. */
export const PROOF_REVIEW_PAGE_SIZE = 50;

function submittedAt(unixNano: bigint): string {
  if (unixNano <= BigInt(0)) return "";
  return new Date(Number(unixNano / BigInt(1_000_000))).toISOString();
}

export function mapProofReview(r: ProofReview): ProofReviewItem {
  return {
    hypothesisId: r.hypothesisId,
    missionId: r.missionId,
    scopeId: r.scopeId,
    technique: r.technique,
    evidence: r.evidence.map((e) => ({ type: e.type, title: e.title, content: e.content })),
    submittedAt: submittedAt(r.submittedAtUnixNano),
  };
}

/** One page of the proofs that wait for a review, in hypothesis id order. */
export async function listProofReviews(pageToken: string): Promise<ProofReviewPage> {
  const res = await userClient(WorldService).listProofReviews({
    pageSize: PROOF_REVIEW_PAGE_SIZE,
    pageToken,
  });
  return { items: res.reviews.map(mapProofReview), nextPageToken: res.nextPageToken };
}
