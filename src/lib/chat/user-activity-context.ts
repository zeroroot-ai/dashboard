import 'server-only';
import { listPrepend, listGetAll, setStr, getStr } from '@/src/lib/redis-store';

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

const TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_ITEMS = 5;

// ============================================================================
// Keys
// ============================================================================

type ActivityKind = 'mission' | 'node' | 'finding';

function activityKey(userId: string, tenantId: string, kind: ActivityKind): string {
  return `useract:${tenantId}:${userId}:${kind}`;
}

function lastActiveKey(userId: string, tenantId: string): string {
  return `useract:${tenantId}:${userId}:lastActive`;
}

// ============================================================================
// Activity recording (fire-and-forget side-effect)
// ============================================================================

/**
 * Record a user activity event. Call fire-and-forget (void) on the render path.
 * Silently no-ops when Redis is unavailable.
 */
export async function recordUserActivity(
  userId: string,
  tenantId: string,
  kind: ActivityKind,
  item: ActivityItem,
): Promise<void> {
  await Promise.all([
    listPrepend(activityKey(userId, tenantId, kind), JSON.stringify(item), MAX_ITEMS, TTL_SECONDS),
    setStr(lastActiveKey(userId, tenantId), String(Date.now()), TTL_SECONDS),
  ]);
}

// ============================================================================
// Context retrieval
// ============================================================================

function parseItems(raw: string[]): ActivityItem[] {
  return raw
    .map((r) => {
      try { return JSON.parse(r) as ActivityItem; } catch { return null; }
    })
    .filter((x): x is ActivityItem => x !== null);
}

/**
 * Fetch the user's recent platform activity from Redis.
 * Returns empty context on any failure — never throws.
 */
export async function getUserActivityContext(
  userId: string,
  tenantId: string,
): Promise<UserActivityContext> {
  try {
    const [missions, nodes, findings, lastActiveRaw] = await Promise.all([
      listGetAll(activityKey(userId, tenantId, 'mission'), MAX_ITEMS),
      listGetAll(activityKey(userId, tenantId, 'node'), MAX_ITEMS),
      listGetAll(activityKey(userId, tenantId, 'finding'), MAX_ITEMS),
      getStr(lastActiveKey(userId, tenantId)),
    ]);

    return {
      recentMissions: parseItems(missions),
      recentNodes: parseItems(nodes),
      recentFindings: parseItems(findings),
      lastActiveAt: lastActiveRaw ? Number(lastActiveRaw) : null,
    };
  } catch {
    return EMPTY;
  }
}
