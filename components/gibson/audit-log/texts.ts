// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The texts of the audit log page (lane 11 row G23).
 *
 * Written in the style of the approved texts (D25, D55, D56, D65). The
 * lane 11 detail file lists each one for the owner.
 */

export const AUDIT_TEXT = {
  menu: "Audit log",
  title: "Audit log",
  intro:
    "This page shows the records of your audit log. Each record names the actor, the kind of actor and the object that the action changed.",
  empty: "The audit log holds no record.",
  columnTime: "Time",
  columnAction: "Action",
  columnActor: "Actor",
  columnActorSource: "Actor type",
  columnTarget: "Target",
  loadMore: "Load more",
} as const;

/** The display text of an actor_source value. An unknown value shows as is. */
export function actorSourceText(source: string): string {
  switch (source) {
    case "user":
      return "User";
    case "agent":
      return "Agent";
    case "system":
      return "System";
    default:
      return source;
  }
}
