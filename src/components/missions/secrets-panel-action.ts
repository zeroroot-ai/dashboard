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
import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";

interface MissionAuditResult {
  accesses: MissionSecretAccess[];
  aggregationLagSeconds: number;
}

/**
 * Fetches the aggregated secret-ref audit for a mission.
 *
 * Called from SecretsAccessedPanel (client component) via server action.
 *
 * Server-side authz (defense-in-depth): the GetMissionAudit RPC dispatches
 * through the user-acting client, whose transport registry-gates every call
 * with a baked-in assertAuthorized check (member relation, dashboard#848 /
 * #902). A denial throws AuthzDeniedError from inside the call; it is mapped
 * here so the "permission_denied" error contract is preserved for the
 * calling panel (dashboard#904). The daemon still performs the authoritative
 * FGA check.
 */
export async function fetchMissionAudit(
  missionId: string,
): Promise<MissionAuditResult> {
  let resp;
  try {
    resp = await getMissionAudit(missionId);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      throw new Error("permission_denied");
    }
    throw err;
  }
  return {
    accesses: (resp.accesses ?? []) as MissionSecretAccess[],
    aggregationLagSeconds: resp.aggregationLagSeconds ?? 0,
  };
}
