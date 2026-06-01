"use server";

/**
 * quota.ts — Server Action for the dashboard's in-app quota UX.
 * Spec plans-and-quotas-simplification R9.B.
 *
 * Returns the live usage snapshot for the current session's tenant.
 * The Plan limits are joined separately from the (cheap, slow-changing)
 * tenant-info path; this action delivers only the live counter values
 * from Redis via GetTenantQuotaUsage.
 */

import { getServerSession } from "@/src/lib/auth";
import { requireActiveTenant } from "@/src/lib/auth/active-tenant";
import { getTenantQuotaUsage } from "@/src/lib/gibson-client";
import { logger } from "@/src/lib/logger";

export type QuotaUsage = {
  missionsActive: number;
  agentsActive: number;
};

/**
 * getQuotaUsage returns a fresh usage snapshot for the current session's
 * tenant. Returns null when no active-tenant cookie is set or the daemon is
 * unreachable, so callers render gracefully.
 */
export async function getQuotaUsage(): Promise<QuotaUsage | null> {
  const session = await getServerSession();
  if (!session?.user) {
    return null;
  }
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch {
    // No active tenant — caller renders gracefully without quota data.
    return null;
  }
  try {
    return await getTenantQuotaUsage(tenantId, tenantId, session.user.id);
  } catch (err) {
    logger.warn({ err: String(err) }, "getQuotaUsage failed; returning null");
    return null;
  }
}
