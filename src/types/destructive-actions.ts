// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Destructive-action authorization queue types (ADR-0028, gibson#278,
 * dashboard#99).
 *
 * ADR-0028 amends ADR-0008: a destructive or irreversible proof-of-
 * demonstration runs only after a human authorizes that SPECIFIC action here.
 * This is distinct from the review/label queue (`/api/world/review`, ADR-0006)
 * — that surface judges whether a finding is real; this surface authorizes
 * whether a dangerous action may run at all. It is also distinct from the
 * HITL settlement surface (dashboard#97) for the same reason.
 *
 * gibson's `DestructiveProofAuthorizer` (internal/engine/brain/bet_settlement.go)
 * is a single synchronous decision function today — `nil` means every
 * destructive request is refused outright, never auto-approved — with no
 * queue, no "pending" record, and no gRPC/REST surface a dashboard can read.
 * These types are a forward-looking, greenfield proposal for that eventual
 * wire shape, not a mirror of an existing proto. `blastRadius` and
 * `reversible`/`reversibilityNote` are ADR-0026/ADR-0028 prose concepts
 * ("its blast radius", "its reversibility") with no upstream Go field yet.
 * See `src/lib/destructive-actions/client.ts` for the stub seam this type
 * feeds until gibson exposes the real RPC.
 */

/** A pending destructive action awaiting one human's approve/deny decision. */
export interface PendingDestructiveAction {
  /**
   * Stable identity for approve/deny. gibson has not minted an id for this
   * shape yet (BetSettlementRequest carries no id field); the eventual daemon
   * implementation will need one (likely hypothesisId + a nonce, since a
   * hypothesis can be re-attempted). Treated as an opaque string here.
   */
  id: string;
  missionId: string;
  scopeId: string;
  /** The hypothesis this bet is about (Hypothesis.ID, gibson#265). */
  hypothesisId: string;
  /** The hypothesis's claim text (Hypothesis.Claim) — "the bet it belongs to". */
  claim: string;
  /** The settlement technique this demonstration would run. */
  technique: string;
  /** The predicate type + params this action would satisfy (gibson#278). */
  predicateType: string;
  predicateParams: unknown;
  /** Human-readable description of what the action would do. */
  action: string;
  /** Human-readable blast-radius description (e.g. "single host: 10.0.0.5"). */
  blastRadius: string;
  reversible: boolean;
  /** Why the action is/is not reversible. */
  reversibilityNote: string;
  /** ISO-8601 timestamp of when the demonstration asked for authorization. */
  requestedAt: string;
}

/** A human's decision on one pending destructive action. */
export type DestructiveActionDecision = "approve" | "deny";

/** Response body for `GET /api/world/destructive-actions`. */
export interface DestructiveActionQueueResponse {
  items: PendingDestructiveAction[];
  /**
   * False when gibson's authorization backend is not wired yet (the current
   * production state — see the module doc above). The queue is legitimately
   * empty in that case, not broken; the UI renders a distinct "not connected"
   * state rather than a generic empty-queue message.
   */
  available: boolean;
}
