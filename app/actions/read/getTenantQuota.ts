"use server";

/**
 * getTenantQuotaAction — read-side Server Action for the Plan & Usage
 * section. Reads plan limits from the daemon's tenant_quotas Postgres row
 * and the live usage snapshot from Redis in a single gRPC call
 * (DaemonAdminService.GetTenantQuota).
 *
 * Spec: access-matrix-finish task 11, R4 AC 2 + 7.
 */

import { getDaemonAdminClient } from "@/src/lib/gibson-admin-client";
import { getServerSession } from "@/src/lib/auth";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface TenantQuotaRow {
  seats: number;
  concurrentAgents: number;
  storageGb: number;
  retentionDays: number;
  sandboxLaunchesPerMonth: number;
  updatedAt: string;
  currentSeats: number;
  currentConcurrentAgents: number;
  currentStorageGb: number;
  currentSandboxLaunchesThisMonth: number;
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
    const resp = await getDaemonAdminClient().getTenantQuota({ tenantId });
    return {
      ok: true,
      data: {
        seats: resp.seats,
        concurrentAgents: resp.concurrentAgents,
        storageGb: resp.storageGb,
        retentionDays: resp.retentionDays,
        sandboxLaunchesPerMonth: resp.sandboxLaunchesPerMonth,
        updatedAt: resp.updatedAt,
        currentSeats: resp.currentSeats,
        currentConcurrentAgents: resp.currentConcurrentAgents,
        currentStorageGb: resp.currentStorageGb,
        currentSandboxLaunchesThisMonth: resp.currentSandboxLaunchesThisMonth,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
