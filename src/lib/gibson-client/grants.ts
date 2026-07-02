import 'server-only';

/**
 * Typed dashboard client methods for gibson.tenant.v1.GrantsService.
 *
 * Read-only in v1. Backs the dashboard's capability-grant inspector page
 * (Requirement 4). RBAC is gated on tenant_admin by the daemon's ext-authz.
 *
 * Spec: secrets-tenant-lifecycle Task 6, Requirements 4, 8.1.
 */

import { userClient } from '../gibson-client';
import { GrantsService } from '@/src/gen/gibson/tenant/v1/grants_pb';
import type { ListActiveGrantsResponse } from '@/src/gen/gibson/tenant/v1/grants_pb';
// CapabilityGrantInfo + RecipientClass were extracted from
// gibson.admin.v1 → gibson.capability.v1 (sdk#103) so non-admin
// callers can describe a grant without pulling the admin surface.
import type { CapabilityGrantInfo } from '@/src/gen/gibson/capability/v1/capability_pb';
import { RecipientClass } from '@/src/gen/gibson/capability/v1/capability_pb';
import { throwMapped } from './secrets';

export type { CapabilityGrantInfo };
export { RecipientClass };

interface ListActiveGrantsOptions {
  /** Filter by recipient class; UNSPECIFIED (0) means all. */
  recipientClassFilter?: RecipientClass;
  /** Filter to grants whose allowed_rpcs includes this method name. */
  rpcFilter?: string;
  /** When true, returns only grants expiring within 5 minutes. */
  includeNearExpiryOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Returns active capability grants for the tenant resolved from identity.
 * Optionally filtered by recipient class, RPC, and near-expiry status.
 *
 * Read-only, there is no revoke surface in v1.
 */
export async function listActiveGrants(
  opts: ListActiveGrantsOptions = {},
): Promise<ListActiveGrantsResponse> {
  try {
    const client = userClient(GrantsService);
    return await client.listActiveGrants({
      recipientClassFilter: opts.recipientClassFilter ?? 0,
      rpcFilter: opts.rpcFilter ?? '',
      includeNearExpiryOnly: opts.includeNearExpiryOnly ?? false,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    });
  } catch (err) {
    throwMapped(err);
  }
}
