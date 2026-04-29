"use server";

/**
 * secrets-panel-action.ts — Server action backing SecretsAccessedPanel.
 *
 * Wraps getMissionAudit so the client panel can call it without importing
 * the server-only gibson-client directly.
 *
 * Returns the raw GetMissionAuditResponse fields needed by the panel.
 * The value field is structurally absent from the response (enforced by the
 * proto definition) — refs only.
 *
 * Spec: secrets-tenant-lifecycle Task 17, Requirement 6.
 */

import { getMissionAudit } from "@/src/lib/gibson-client/secrets";
import type { MissionSecretAccess } from "@/src/lib/gibson-client/secrets";

export interface MissionAuditResult {
  accesses: MissionSecretAccess[];
  aggregationLagSeconds: number;
}

/**
 * Fetches the aggregated secret-ref audit for a mission.
 *
 * Called from SecretsAccessedPanel (client component) via server action.
 */
export async function fetchMissionAudit(
  missionId: string,
): Promise<MissionAuditResult> {
  const resp = await getMissionAudit(missionId);
  return {
    accesses: (resp.accesses ?? []) as MissionSecretAccess[],
    aggregationLagSeconds: resp.aggregationLagSeconds ?? 0,
  };
}
