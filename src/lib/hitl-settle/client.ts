// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";

import type {
  BetVerdict,
  HitlSettleVerdictResponse,
  OpenBetForReview,
} from "@/src/types/hitl-settle";

/**
 * HITL bet-settlement backend seam (ADR-0023, gibson#264/#266/#280,
 * dashboard#97).
 *
 * gibson#280 added `SettleBetByHITL` and a `LabelApplied` Timeline event on
 * the daemon side, but — as of this slice — there is no confirmed
 * gRPC/REST surface the dashboard can call to list OPEN bets or submit a
 * verdict. This module is the ONE seam a real implementation replaces once
 * that surface exists (mirroring `src/lib/destructive-actions/client.ts`,
 * dashboard#99's identical seam for the still-unwired destructive-action
 * authorizer): swap `UnwiredHitlSettleClient` for a ConnectRPC-backed
 * implementation of `HitlSettleClient` and nothing above this file (the
 * route handler, the hook, the component) needs to change.
 *
 * `submitVerdict`'s intended real semantics (for whoever wires the RPC):
 * `SettleBetByHITL` (bet_settlement.go:592) REFUSES `VerdictDismiss` outright
 * — only `true_positive`/`false_positive` settle a bet. A real
 * implementation should route "dismiss" to a label-only write (the same
 * `LabelApplied` channel, no settlement) and set `didSettle: false` on the
 * response, while "true_positive"/"false_positive" call `SettleBetByHITL`
 * and set `didSettle: true`.
 */

export interface HitlSettleClient {
  /** Every OPEN bet in this tenant awaiting a human verdict. */
  listOpenBets(): Promise<OpenBetForReview[]>;
  /** Record one human's verdict, settling the bet (SettleBetByHITL). */
  submitVerdict(
    id: string,
    verdict: BetVerdict,
    category?: string,
  ): Promise<HitlSettleVerdictResponse>;
}

/**
 * Thrown by the stub client. Callers (the API route) treat this as "the
 * queue is legitimately empty because nothing can be judged yet", not as a
 * daemon error — see `HitlSettleQueueResponse.available`.
 */
export class HitlSettleBackendUnavailableError extends Error {
  constructor() {
    super(
      "The HITL bet-settlement backend is not wired yet: gibson#280's " +
        "SettleBetByHITL has no confirmed gRPC/REST surface for listing " +
        "OPEN bets or submitting a verdict. This is the dashboard#97 stub " +
        "seam (src/lib/hitl-settle/client.ts).",
    );
    this.name = "HitlSettleBackendUnavailableError";
  }
}

class UnwiredHitlSettleClient implements HitlSettleClient {
  async listOpenBets(): Promise<OpenBetForReview[]> {
    throw new HitlSettleBackendUnavailableError();
  }

  async submitVerdict(): Promise<HitlSettleVerdictResponse> {
    throw new HitlSettleBackendUnavailableError();
  }
}

const defaultClient: HitlSettleClient = new UnwiredHitlSettleClient();

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

/** Test-only reset back to the unwired stub. Call from `afterEach`. */
export function __resetHitlSettleClientForTest(): void {
  activeClient = defaultClient;
}
