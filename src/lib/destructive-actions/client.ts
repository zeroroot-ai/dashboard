// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import "server-only";

import { userClient } from "@/src/lib/gibson-client";
import {
  DestructiveAuthorizationService,
  Reversibility,
} from "@/src/gen/gibson/daemon/destructiveauthz/v1/destructive_authz_pb";
import type { PendingDestructiveAction as PbPendingDestructiveAction } from "@/src/gen/gibson/daemon/destructiveauthz/v1/destructive_authz_pb";
import type {
  DestructiveActionDecision,
  DestructiveReversibility,
  PendingDestructiveAction,
} from "@/src/types/destructive-actions";

/**
 * Destructive-action authorization client (ADR-0028, gibson#278/#336,
 * dashboard#99).
 *
 * The queue is backed by
 * `gibson.daemon.destructiveauthz.v1.DestructiveAuthorizationService`:
 * `ListPendingDestructiveActions` reads the tenant's pending actions, and
 * `ApproveDestructiveAction` / `DenyDestructiveAction` record one human's
 * per-action decision. Every call goes through the sanctioned `userClient`
 * transport (Envoy + ext-authz); the dashboard never opens a direct daemon
 * channel.
 *
 * This module is the one seam that maps the generated proto message into the
 * plain view type the route returns. The route reads it through
 * `getDestructiveActionsClient()`, and route tests swap in a fake via
 * `__setDestructiveActionsClientForTest`.
 */

export interface DestructiveActionsClient {
  /** Every pending destructive action awaiting this tenant's decision. */
  listPending(): Promise<PendingDestructiveAction[]>;
  /** Record one human's approve/deny decision for a specific pending action. */
  decide(id: string, decision: DestructiveActionDecision): Promise<void>;
}

function mapReversibility(r: Reversibility): DestructiveReversibility {
  switch (r) {
    case Reversibility.REVERSIBLE:
      return "reversible";
    case Reversibility.IRREVERSIBLE:
      return "irreversible";
    default:
      return "unspecified";
  }
}

function mapAction(a: PbPendingDestructiveAction): PendingDestructiveAction {
  return {
    id: a.actionId,
    missionId: a.missionId,
    scopeId: a.scopeId,
    hypothesisId: a.hypothesisId,
    technique: a.technique,
    predicateType: a.predicateType,
    blastRadius: a.blastRadius,
    reversibility: mapReversibility(a.reversibility),
    requestedAt:
      Number(a.requestedAtUnixMs) > 0
        ? new Date(Number(a.requestedAtUnixMs)).toISOString()
        : "",
  };
}

class DaemonDestructiveActionsClient implements DestructiveActionsClient {
  async listPending(): Promise<PendingDestructiveAction[]> {
    const res = await userClient(DestructiveAuthorizationService).listPendingDestructiveActions({});
    return res.actions.map(mapAction);
  }

  async decide(id: string, decision: DestructiveActionDecision): Promise<void> {
    const client = userClient(DestructiveAuthorizationService);
    if (decision === "approve") {
      await client.approveDestructiveAction({ actionId: id });
    } else {
      await client.denyDestructiveAction({ actionId: id });
    }
  }
}

const defaultClient: DestructiveActionsClient = new DaemonDestructiveActionsClient();

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

/** Test-only reset back to the real client. Call from `afterEach`. */
export function __resetDestructiveActionsClientForTest(): void {
  activeClient = defaultClient;
}
