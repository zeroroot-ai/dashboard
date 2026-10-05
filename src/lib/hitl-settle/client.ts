// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";

import { userClient } from "@/src/lib/gibson-client";
import { WorldService } from "@/src/gen/gibson/world/v1/world_pb";
import type { OpenBet } from "@/src/gen/gibson/world/v1/world_pb";
import type {
  BetVerdict,
  HitlSettleVerdictResponse,
  OpenBetForReview,
} from "@/src/types/hitl-settle";

/**
 * HITL bet-settlement client (ADR-0123, gibson#264/#266/#280, dashboard#97).
 *
 * The queue is backed by `gibson.world.v1.WorldService`: `ListOpenBets` reads
 * the tenant's placed-but-unsettled bets and `SettleBetByHITL` records one
 * human's verdict. Both go through the sanctioned `userClient` transport
 * (Envoy + ext-authz); the dashboard never opens a direct daemon channel.
 *
 * This module is the one seam that maps the generated proto messages into the
 * plain view types the route returns. The route reads it through
 * `getHitlSettleClient()`, and route tests swap in a fake via
 * `__setHitlSettleClientForTest` so they can exercise the route contract
 * without a live daemon.
 */

export interface HitlSettleClient {
  /** Every OPEN bet in this tenant awaiting a human verdict. */
  listOpenBets(): Promise<OpenBetForReview[]>;
  /** Record one human's verdict (SettleBetByHITL). */
  submitVerdict(id: string, verdict: BetVerdict): Promise<HitlSettleVerdictResponse>;
}

function mapBet(bet: OpenBet): OpenBetForReview {
  return {
    id: bet.hypothesisId,
    hypothesisId: bet.hypothesisId,
    claim: bet.claim,
    proposer: bet.proposer,
    confidence: bet.confidence,
    evidence: bet.evidence.map((e) => ({
      label: e.label,
      idProperties: { ...e.idProperties },
    })),
    runId: bet.runId,
  };
}

function effectFor(verdict: BetVerdict, didSettle: boolean): string {
  if (didSettle) {
    return "Bet settled. The fleet's belief and this technique's reputation are updated.";
  }
  if (verdict === "dismiss") {
    return "Labeled dismiss. The bet stays open and nothing was settled.";
  }
  return "The bet was already settled, so this verdict changed nothing.";
}

class WorldServiceHitlSettleClient implements HitlSettleClient {
  async listOpenBets(): Promise<OpenBetForReview[]> {
    const res = await userClient(WorldService).listOpenBets({});
    return res.bets.map(mapBet);
  }

  async submitVerdict(id: string, verdict: BetVerdict): Promise<HitlSettleVerdictResponse> {
    const res = await userClient(WorldService).settleBetByHITL({
      hypothesisId: id,
      verdict,
    });
    return {
      ok: true,
      settled: verdict,
      didSettle: res.settled,
      effect: effectFor(verdict, res.settled),
    };
  }
}

const defaultClient: HitlSettleClient = new WorldServiceHitlSettleClient();

let activeClient: HitlSettleClient = defaultClient;

/** The seam every caller (route handlers) goes through. */
export function getHitlSettleClient(): HitlSettleClient {
  return activeClient;
}

/**
 * Test-only override. Route contract tests use this to exercise the
 * list/submit paths without a live daemon; production code never calls it.
 */
export function __setHitlSettleClientForTest(client: HitlSettleClient): void {
  activeClient = client;
}

/** Test-only reset back to the real client. Call from `afterEach`. */
export function __resetHitlSettleClientForTest(): void {
  activeClient = defaultClient;
}
