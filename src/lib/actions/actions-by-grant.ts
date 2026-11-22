// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The connector calls of the agents, grouped by the grant that allowed each
 * one and by the person who gave the grant (gibson#1499). The daemon groups
 * and counts. The dashboard groups and counts nothing.
 */

import type {
  ActionGroup,
  ListActionsByGrantResponse,
} from "@/src/gen/gibson/world/v1/world_pb";

export interface ActionGroupView {
  /** The grant that allowed the action. For a refused action, the grant that it lacked. */
  grantObject: string;
  grantRelation: string;
  /** Empty when the audit record holds no grant, and for a refused action. */
  grantor: string;
  refused: boolean;
  count: number;
  /** ISO times. Empty when the daemon sends none. */
  first: string;
  last: string;
  agents: string[];
  tools: string[];
}

export interface ActionsByGrant {
  groups: ActionGroupView[];
  /** True when the range holds more audit records than one read returns. */
  truncated: boolean;
}

function iso(t: { seconds: bigint; nanos: number } | undefined): string {
  return t ? new Date(Number(t.seconds) * 1000 + Math.floor(t.nanos / 1e6)).toISOString() : "";
}

function toGroup(g: ActionGroup): ActionGroupView {
  return {
    grantObject: g.grantObject,
    grantRelation: g.grantRelation,
    grantor: g.grantor,
    refused: g.refused,
    count: g.count,
    first: iso(g.first),
    last: iso(g.last),
    agents: [...g.agents],
    tools: [...g.tools],
  };
}

export function toActionsByGrant(r: Pick<ListActionsByGrantResponse, "groups" | "truncated">): ActionsByGrant {
  return { groups: r.groups.map(toGroup), truncated: r.truncated };
}

/** The grant as one line: "object#relation". */
export function grantLabel(g: Pick<ActionGroupView, "grantObject" | "grantRelation">): string {
  if (!g.grantObject && !g.grantRelation) return "";
  return g.grantRelation ? `${g.grantObject}#${g.grantRelation}` : g.grantObject;
}
