// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";

import type {
  DestructiveActionDecision,
  PendingDestructiveAction,
} from "@/src/types/destructive-actions";

/**
 * Destructive-action authorization backend seam (ADR-0028, gibson#278,
 * dashboard#99).
 *
 * There is no gRPC/REST surface for this queue today. gibson's
 * `DestructiveProofAuthorizer` (internal/engine/brain/bet_settlement.go) is a
 * single synchronous Go function type invoked in-process from
 * `Engine.SettleBetTrue`:
 *
 *   type DestructiveProofAuthorizer func(ctx, tenant, req BetSettlementRequest) (approved bool, err error)
 *
 * `nil` means no authorizer is wired — which is production reality right
 * now — and every destructive request is refused outright, never queued and
 * never auto-approved. There is no "pending" record, no id, and no Timeline
 * event for the request or the decision yet.
 *
 * This module is the ONE seam a real implementation replaces once gibson
 * exposes that queue over the wire (mirroring how `gibson-client/transport.ts`
 * is the one seam for the real daemon transport): swap
 * `UnwiredDestructiveActionsClient` for a ConnectRPC-backed implementation of
 * `DestructiveActionsClient` and nothing above this file (the route handler,
 * the hook, the component) needs to change.
 */

export interface DestructiveActionsClient {
  /** Every pending destructive action awaiting this tenant's decision. */
  listPending(): Promise<PendingDestructiveAction[]>;
  /** Record one human's approve/deny decision for a specific pending action. */
  decide(id: string, decision: DestructiveActionDecision, reason?: string): Promise<void>;
}

/**
 * Thrown by the stub client. Callers (the API route) treat this as "the
 * queue is legitimately empty because nothing can be authorized yet", not as
 * a daemon error — see `DestructiveActionQueueResponse.available`.
 */
export class DestructiveActionsBackendUnavailableError extends Error {
  constructor() {
    super(
      "The destructive-action authorization backend is not wired yet: " +
        "gibson's DestructiveProofAuthorizer (ADR-0028) has no queue, id, or " +
        "wire surface — a destructive proof is refused outright, never queued. " +
        "This is the dashboard#99 stub seam (src/lib/destructive-actions/client.ts).",
    );
    this.name = "DestructiveActionsBackendUnavailableError";
  }
}

class UnwiredDestructiveActionsClient implements DestructiveActionsClient {
  async listPending(): Promise<PendingDestructiveAction[]> {
    throw new DestructiveActionsBackendUnavailableError();
  }

  async decide(): Promise<void> {
    throw new DestructiveActionsBackendUnavailableError();
  }
}

const defaultClient: DestructiveActionsClient = new UnwiredDestructiveActionsClient();

let activeClient: DestructiveActionsClient = defaultClient;

/** The seam every caller (route handlers) goes through. */
export function getDestructiveActionsClient(): DestructiveActionsClient {
  return activeClient;
}

/**
 * Test-only override. Route contract tests use this to exercise the
 * list/decide paths without a live daemon; production code never calls it.
 */
export function __setDestructiveActionsClientForTest(client: DestructiveActionsClient): void {
  activeClient = client;
}

/** Test-only reset back to the unwired stub. Call from `afterEach`. */
export function __resetDestructiveActionsClientForTest(): void {
  activeClient = defaultClient;
}
