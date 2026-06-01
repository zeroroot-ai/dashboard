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

import { TenantService } from "@/src/gen/gibson/tenant/v1/tenant_pb";
import { userClient } from "@/src/lib/gibson-client";
import { getServerSession } from "@/src/lib/auth";
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from "@/src/lib/auth/active-tenant";

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
  /** Canonical plan identifier (e.g. "team", "org", "enterprise"). */
  planId: string;
}

export async function getTenantQuotaAction(): Promise<
  ActionResult<TenantQuotaRow>
> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError) {
      return { ok: false, error: "no_active_tenant" };
    }
    if (err instanceof StaleActiveTenantError) {
      return { ok: false, error: "stale_active_tenant" };
    }
    throw err;
  }

  try {
    const client = userClient(TenantService);
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
        planId: limits.planId ?? "",
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
