"use server";

/**
 * secrets-panel-action.ts, Server action backing SecretsAccessedPanel.
 *
 * Wraps getMissionAudit so the client panel can call it without importing
 * the server-only gibson-client directly.
 *
 * Returns the raw GetMissionAuditResponse fields needed by the panel.
 * The value field is structurally absent from the response (enforced by the
 * proto definition), refs only.
 *
 * Spec: secrets-tenant-lifecycle Task 17, Requirement 6.
 */

import { getMissionAudit } from "@/src/lib/gibson-client/secrets";
import type { MissionSecretAccess } from "@/src/lib/gibson-client/secrets";
import { assertAuthorized, AuthzDeniedError } from "@/src/lib/auth/assert-authorized";

// The RPC this action wraps. Authorization derives from its AuthRegistry
// relation (member, any tenant member may read mission secret-access audit),
// the single authorization source of truth shared with useAuthorize.
const GET_MISSION_AUDIT_RPC =
  "/gibson.tenant.v1.SecretsService/GetMissionAudit";

interface MissionAuditResult {
  accesses: MissionSecretAccess[];
  aggregationLagSeconds: number;
}

/**
 * Fetches the aggregated secret-ref audit for a mission.
 *
 * Called from SecretsAccessedPanel (client component) via server action.
 *
 * Server-side authz pre-check (defense-in-depth): authorizes the caller for
 * the GetMissionAudit RPC via the AuthRegistry (member relation) before
 * touching the daemon. The daemon still performs the authoritative FGA check;
 * this gate ensures the dashboard layer never proxies an unauthenticated /
 * under-permitted read. The "permission_denied" error contract is preserved
 * for the calling panel.
 */
export async function fetchMissionAudit(
  missionId: string,
): Promise<MissionAuditResult> {
  try {
    await assertAuthorized(GET_MISSION_AUDIT_RPC);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      throw new Error("permission_denied");
    }
    throw err;
  }
  const resp = await getMissionAudit(missionId);
  return {
    accesses: (resp.accesses ?? []) as MissionSecretAccess[],
    aggregationLagSeconds: resp.aggregationLagSeconds ?? 0,
  };
}
