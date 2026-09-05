import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the daemon client and UserService before importing the module under test.
const mockGetUserActivity = vi.fn();
const mockRecordUserActivity = vi.fn();

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: () => ({
    getUserActivity: (...args: unknown[]) => mockGetUserActivity(...args),
    recordUserActivity: (...args: unknown[]) => mockRecordUserActivity(...args),
  }),
}));

vi.mock('@/src/gen/gibson/tenant/v1/user_pb', () => ({
  UserService: {},
  ActivityKind: {
    ACTIVITY_KIND_UNSPECIFIED: 0,
    MISSION: 1,
    NODE: 2,
    FINDING: 3,
  },
}));

// mock server-only so the import doesn't fail in test env
vi.mock('server-only', () => ({}));

vi.mock('@/src/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

import { getUserActivityContext, recordUserActivity } from '../user-activity-context';

const userId = 'user-1';
const tenantId = 'tenant-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUserActivityContext', () => {
  it('returns populated context from daemon response', async () => {
    mockGetUserActivity.mockResolvedValue({
      activity: {
        recentMissions: [{ id: 'm1', label: 'Mission Alpha', timestampUnix: BigInt(1000) }],
        recentNodes: [{ id: 'n1', label: 'Host: 10.0.0.1', timestampUnix: BigInt(2000) }],
        recentFindings: [{ id: 'f1', label: 'CVE-2024-1234 (Critical)', timestampUnix: BigInt(3000) }],
        lastActiveAtUnix: BigInt(1700000000000),
      },
    });

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx.recentMissions).toEqual([{ id: 'm1', label: 'Mission Alpha', timestamp: 1000 }]);
    expect(ctx.recentNodes).toEqual([{ id: 'n1', label: 'Host: 10.0.0.1', timestamp: 2000 }]);
    expect(ctx.recentFindings).toEqual([{ id: 'f1', label: 'CVE-2024-1234 (Critical)', timestamp: 3000 }]);
    expect(ctx.lastActiveAt).toBe(1700000000000);
  });

  it('returns empty struct when daemon returns empty activity', async () => {
    mockGetUserActivity.mockResolvedValue({
      activity: {
        recentMissions: [],
        recentNodes: [],
        recentFindings: [],
        lastActiveAtUnix: BigInt(0),
      },
    });

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx).toEqual({ recentMissions: [], recentNodes: [], recentFindings: [], lastActiveAt: null });
  });

  it('returns empty struct when daemon returns no activity field', async () => {
    mockGetUserActivity.mockResolvedValue({ activity: undefined });

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx).toEqual({ recentMissions: [], recentNodes: [], recentFindings: [], lastActiveAt: null });
  });

  it('returns empty struct when RPC throws', async () => {
    mockGetUserActivity.mockRejectedValue(new Error('daemon down'));

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx).toEqual({ recentMissions: [], recentNodes: [], recentFindings: [], lastActiveAt: null });
  });
});

describe('recordUserActivity', () => {
  it('calls recordUserActivity RPC with correct args for mission kind', async () => {
    mockRecordUserActivity.mockResolvedValue({});

    const item = { id: 'm1', label: 'Mission Alpha', timestamp: 1234567890 };
    await recordUserActivity(userId, tenantId, 'mission', item);

    expect(mockRecordUserActivity).toHaveBeenCalledOnce();
    const [req] = mockRecordUserActivity.mock.calls[0] as [
      { tenantId: string; userId: string; kind: number; item: { id: string; label: string } }
    ];
    expect(req.tenantId).toBe(tenantId);
    expect(req.userId).toBe(userId);
    expect(req.kind).toBe(1); // ActivityKind.MISSION
    expect(req.item.id).toBe('m1');
    expect(req.item.label).toBe('Mission Alpha');
  });

  it('silently no-ops when RPC throws', async () => {
    mockRecordUserActivity.mockRejectedValue(new Error('daemon down'));

    const item = { id: 'm1', label: 'Mission Alpha', timestamp: Date.now() };
    // Must not throw.
    await expect(recordUserActivity(userId, tenantId, 'mission', item)).resolves.toBeUndefined();
  });
});
