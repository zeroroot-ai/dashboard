import 'server-only';

/**
 * Typed dashboard client methods for gibson.admin.v1.GrantsAdminService.
 *
 * Read-only in v1. Backs the dashboard's capability-grant inspector page
 * (Requirement 4). RBAC is gated on tenant_admin by the daemon's ext-authz.
 *
 * Spec: secrets-tenant-lifecycle Task 6, Requirements 4, 8.1.
 */

import { userClient } from '../gibson-client';
import { GrantsAdminService } from '@/src/gen/gibson/admin/v1/grants_pb';
import type {
  CapabilityGrantInfo,
  ListActiveGrantsResponse,
  RecipientClass,
} from '@/src/gen/gibson/admin/v1/grants_pb';
import { throwMapped } from './secrets';

export type { CapabilityGrantInfo, ListActiveGrantsResponse, RecipientClass };

export interface ListActiveGrantsOptions {
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
 * Read-only — there is no revoke surface in v1.
 */
export async function listActiveGrants(
  opts: ListActiveGrantsOptions = {},
): Promise<ListActiveGrantsResponse> {
  try {
    const client = userClient(GrantsAdminService);
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
