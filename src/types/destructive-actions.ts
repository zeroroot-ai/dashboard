// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Destructive-action authorization queue types (ADR-0028, gibson#278/#336,
 * dashboard#99).
 *
 * ADR-0028 amends ADR-0008: a destructive or irreversible proof-of-
 * demonstration runs only after a human authorizes that SPECIFIC action here.
 * This is distinct from the review/label queue (`/api/world/review`, ADR-0006),
 * which judges whether a finding is real, and from the HITL settlement surface
 * (dashboard#97), which judges a bet's verdict. This surface authorizes whether
 * a dangerous action may run at all.
 *
 * These are the plain, over-the-wire JSON shapes the route maps the generated
 * `PendingDestructiveAction` message into; the hook and the component read
 * them, never the generated proto. `blastRadius` and `reversibility` come
 * straight from the daemon: today both can be empty / unspecified, because the
 * Domain Pack risk-tier signal they are meant to come from is not built yet
 * (the only live signal is that the action is destructive at all, which is why
 * it reached the queue). The UI surfaces that honestly rather than inventing a
 * value.
 */

/** The daemon's reversibility signal for a pending action. */
export type DestructiveReversibility = 'reversible' | 'irreversible' | 'unspecified';

/** A pending destructive action awaiting one human's approve/deny decision. */
export interface PendingDestructiveAction {
  /** Stable identity for approve/deny (the daemon's action_id, equal to the hypothesis id). */
  id: string;
  missionId: string;
  scopeId: string;
  /** The hypothesis/bet this action would settle (gibson#265). */
  hypothesisId: string;
  /** The settlement technique this demonstration would run. */
  technique: string;
  /** The predicate type this action would satisfy (gibson#278). */
  predicateType: string;
  /** Human-readable blast-radius description; "" when the daemon has none yet. */
  blastRadius: string;
  /** Whether the action is reversible; "unspecified" when the daemon has no signal yet. */
  reversibility: DestructiveReversibility;
  /** ISO-8601 timestamp of when the demonstration asked for authorization; "" when unknown. */
  requestedAt: string;
}

/** A human's decision on one pending destructive action. */
export type DestructiveActionDecision = 'approve' | 'deny';

/** Response body for `GET /api/world/destructive-actions`. */
export interface DestructiveActionQueueResponse {
  items: PendingDestructiveAction[];
}
