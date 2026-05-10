"use server";

/**
 * getTenantQuotaAction — read-side Server Action for the Plan & Usage
 * section. Reads plan limits from the daemon's tenant_quotas Postgres
 * row via TenantAdminService.GetTenantQuota and the live counter
 * snapshot via TenantAdminService.GetTenantQuotaUsage.
 *
 * Spec plans-and-quotas-simplification reduces the schema to two
 * enforced quotas (concurrent_missions / concurrent_agents); legacy
 * fields (seats, storage_gb, retention_days, sandbox_launches_per_month)
 * are removed end-to-end.
 */

import { TenantAdminService } from "@/src/gen/gibson/tenant/v1/tenant_admin_pb";
import { serviceClient } from "@/src/lib/gibson-client";
import { getServerSession } from "@/src/lib/auth";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TenantQuotaRow {
  /** Concurrent missions limit (0 = unlimited). */
  concurrentMissions: number;
  /** Concurrent agents limit (0 = unlimited). */
  concurrentAgents: number;
  /** Postgres updated_at (RFC 3339). */
  updatedAt: string;
  /** Live missions-active counter from Redis. */
  currentConcurrentMissions: number;
  /** Live agents-active counter from Redis. */
  currentConcurrentAgents: number;
}

export async function getTenantQuotaAction(): Promise<
  ActionResult<TenantQuotaRow>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }
  const tenantId =
    (session.user as { tenantId?: string }).tenantId ?? "";
  if (!tenantId) {
    return { ok: false, error: "no tenant in session" };
  }

  try {
    const client = serviceClient(TenantAdminService, tenantId);
    const [limits, usage] = await Promise.all([
      client.getTenantQuota({ tenantId }),
      client.getTenantQuotaUsage({ tenantId }),
    ]);
    return {
      ok: true,
      data: {
        concurrentMissions: limits.concurrentMissions ?? 0,
        concurrentAgents: limits.concurrentAgents ?? 0,
        updatedAt: limits.updatedAt ?? "",
        currentConcurrentMissions: Number(usage.missionsActive ?? 0),
        currentConcurrentAgents: Number(usage.agentsActive ?? 0),
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
