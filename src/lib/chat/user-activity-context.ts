/**
 * user-activity-context.ts
 *
 * Retrieves and records per-user platform activity via the daemon's
 * UserService.GetUserActivity / RecordUserActivity RPCs.
 *
 * Replaces the previous direct-Redis implementation.
 * Spec: dashboard-no-backing-store-clients (Module 5 / issue #589).
 */

import 'server-only';

import { userClient } from '@/src/lib/gibson-client';
import {
  UserService,
  ActivityKind,
} from '@/src/gen/gibson/tenant/v1/user_pb';
import { logger } from '@/src/lib/logger';

// ============================================================================
// Types
// ============================================================================

export interface ActivityItem {
  id: string;
  label: string;
  timestamp: number;
}

export interface UserActivityContext {
  recentMissions: ActivityItem[];
  recentNodes: ActivityItem[];
  recentFindings: ActivityItem[];
  lastActiveAt: number | null;
}

const EMPTY: UserActivityContext = {
  recentMissions: [],
  recentNodes: [],
  recentFindings: [],
  lastActiveAt: null,
};

// ============================================================================
// Activity recording (fire-and-forget side-effect)
// ============================================================================

type ActivityKindLabel = 'mission' | 'node' | 'finding';

function toProtoKind(kind: ActivityKindLabel): ActivityKind {
  switch (kind) {
    case 'mission': return ActivityKind.MISSION;
    case 'node': return ActivityKind.NODE;
    case 'finding': return ActivityKind.FINDING;
  }
}

/**
 * Record a user activity event via the daemon. Call fire-and-forget (void)
 * on the render path. Silently no-ops on any error.
 */
export async function recordUserActivity(
  userId: string,
  tenantId: string,
  kind: ActivityKindLabel,
  item: ActivityItem,
): Promise<void> {
  try {
    await userClient(UserService).recordUserActivity({
      tenantId,
      userId,
      kind: toProtoKind(kind),
      item: {
        id: item.id,
        label: item.label,
        timestampUnix: BigInt(item.timestamp),
      },
    });
  } catch (err) {
    logger.warn(
      { err, scope: 'chat.user-activity-context.record' },
      'recordUserActivity RPC failed (non-fatal)',
    );
  }
}

// ============================================================================
// Context retrieval
// ============================================================================

/**
 * Fetch the user's recent platform activity from the daemon.
 * Returns empty context on any failure, never throws.
 */
export async function getUserActivityContext(
  userId: string,
  tenantId: string,
): Promise<UserActivityContext> {
  try {
    const resp = await userClient(UserService).getUserActivity({
      tenantId,
      userId,
    });
    const a = resp.activity;
    if (!a) return EMPTY;
    return {
      recentMissions: a.recentMissions.map((it) => ({
        id: it.id,
        label: it.label,
        timestamp: Number(it.timestampUnix),
      })),
      recentNodes: a.recentNodes.map((it) => ({
        id: it.id,
        label: it.label,
        timestamp: Number(it.timestampUnix),
      })),
      recentFindings: a.recentFindings.map((it) => ({
        id: it.id,
        label: it.label,
        timestamp: Number(it.timestampUnix),
      })),
      lastActiveAt: a.lastActiveAtUnix ? Number(a.lastActiveAtUnix) : null,
    };
  } catch {
    return EMPTY;
  }
}
