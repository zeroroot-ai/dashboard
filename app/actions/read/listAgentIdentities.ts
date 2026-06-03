"use server";

/**
 * listAgentIdentitiesAction — read-side Server Action that enumerates the
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
 * Spec: dashboard#700 — populate per-agent scope dropdown.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import {
  AgentIdentityService,
  PrincipalKind,
} from "@/src/gen/gibson/tenant/v1/agent_identity_pb";
import { userClient } from "@/src/lib/gibson-client";
import { auth } from "@/auth";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Dashboard-safe shape for a single agent identity. */
export interface AgentIdentityRow {
  /** principal_id — the grant target for the Per-agent scope. */
  id: string;
  /** Human-readable agent name. */
  name: string;
}

/**
 * Fetch up to 200 non-revoked agent identities of the active tenant.
 *
 * Returns { ok: true, data: [] } when the daemon returns Unimplemented or
 * Unavailable — the caller degrades gracefully until the handler ships.
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
