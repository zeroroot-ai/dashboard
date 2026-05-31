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
import { getServerSession } from "@/src/lib/auth";
import { hasPermission } from "@/src/lib/auth/schema";

export interface MissionAuditResult {
  accesses: MissionSecretAccess[];
  aggregationLagSeconds: number;
}

/**
 * Fetches the aggregated secret-ref audit for a mission.
 *
 * Called from SecretsAccessedPanel (client component) via server action.
 *
 * Server-side authz pre-check (defense-in-depth): requires an authenticated
 * session carrying `missions:read` before touching the daemon. The daemon
 * still performs the authoritative FGA check on GetMissionAudit; this gate
 * ensures the dashboard layer never proxies an unauthenticated/under-permitted
 * read of mission secret-access audit.
 */
export async function fetchMissionAudit(
  missionId: string,
): Promise<MissionAuditResult> {
  const session = await getServerSession();
  if (!session?.user?.id || !hasPermission(session, "missions:read")) {
    throw new Error("permission_denied");
  }
  const resp = await getMissionAudit(missionId);
  return {
    accesses: (resp.accesses ?? []) as MissionSecretAccess[],
    aggregationLagSeconds: resp.aggregationLagSeconds ?? 0,
  };
}
