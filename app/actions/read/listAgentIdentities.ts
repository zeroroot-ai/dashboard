// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * listAgentIdentitiesAction, read-side Server Action that enumerates the
 * active tenant's non-revoked agent identities for the Per-agent scope of the
 * access-matrix scope selector (AccessScopeSelector).
 *
 * Calls AgentIdentityService.ListAgentIdentities (filtered to AGENT kind) and
 * projects each identity to a dashboard-safe { id, name } shape, where `id` is
 * the principal_id used as the grant target.
 *
 * Graceful fallback: Unimplemented and Unavailable are treated as an empty
 * list so the dropdown renders cleanly before the daemon ships the handler.
 *
 * Spec: dashboard#700, populate per-agent scope dropdown.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import {
  AgentIdentityService,
  PrincipalKind,
} from "@/src/gen/gibson/agentidentity/v1/agent_identity_pb";
import { userClient } from "@/src/lib/gibson-client";
import { auth } from "@/auth";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Dashboard-safe shape for a single agent identity. */
interface AgentIdentityRow {
  /** principal_id, the grant target for the Per-agent scope. */
  id: string;
  /** Human-readable agent name. */
  name: string;
}

/**
 * Fetch up to 200 non-revoked agent identities of the active tenant.
 *
 * Returns { ok: true, data: [] } when the daemon returns Unimplemented or
 * Unavailable, the caller degrades gracefully until the handler ships.
 */
export async function listAgentIdentitiesAction(): Promise<
  ActionResult<AgentIdentityRow[]>
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  try {
    const client = userClient(AgentIdentityService);
    const resp = await client.listAgentIdentities({
      pageSize: 200,
      kindFilter: PrincipalKind.AGENT,
    });
    const rows: AgentIdentityRow[] = (resp.identities ?? [])
      .filter((i) => !i.revoked)
      .map((i) => ({ id: i.principalId, name: i.name || i.principalId }));
    return { ok: true, data: rows };
  } catch (err) {
    if (err instanceof ConnectError) {
      if (err.code === Code.Unimplemented || err.code === Code.Unavailable) {
        return { ok: true, data: [] };
      }
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Dashboard-safe shape for an identity of any kind. */
interface IdentitySummary {
  /** principal_id, for example "agent_principal:<id>". */
  id: string;
  /** Human-readable name. */
  name: string;
  /** "agent", "tool" or "plugin". */
  kind: "agent" | "tool" | "plugin";
}

function kindLabel(kind: PrincipalKind): IdentitySummary["kind"] {
  switch (kind) {
    case PrincipalKind.TOOL:
      return "tool";
    case PrincipalKind.PLUGIN:
      return "plugin";
    default:
      return "agent";
  }
}

/**
 * Fetch the name and kind of the given identities of the active tenant. The
 * users page uses it after a removal, to show the identities that moved to
 * the caller (gibson#568, dashboard#178). An identity the daemon does not
 * list keeps its id as its name.
 */
export async function describeIdentitiesAction(
  principalIds: string[],
): Promise<ActionResult<IdentitySummary[]>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }
  if (principalIds.length === 0) {
    return { ok: true, data: [] };
  }
  try {
    const client = userClient(AgentIdentityService);
    const resp = await client.listAgentIdentities({ pageSize: 200 });
    const byId = new Map((resp.identities ?? []).map((i) => [i.principalId, i]));
    const rows: IdentitySummary[] = principalIds.map((id) => {
      const found = byId.get(id);
      const prefix = id.split(":")[0] ?? "";
      const fallbackKind: IdentitySummary["kind"] = prefix.startsWith("tool")
        ? "tool"
        : prefix.startsWith("plugin")
          ? "plugin"
          : "agent";
      return {
        id,
        name: found?.name || id,
        kind: found ? kindLabel(found.kind) : fallbackKind,
      };
    });
    return { ok: true, data: rows };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
