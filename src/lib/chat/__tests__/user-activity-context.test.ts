import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the redis-store helpers before importing the module under test
vi.mock('@/src/lib/redis-store', () => ({
  listPrepend: vi.fn(),
  listGetAll: vi.fn(),
  setStr: vi.fn(),
  getStr: vi.fn(),
}));

// mock server-only so the import doesn't fail in test env
vi.mock('server-only', () => ({}));

import { listPrepend, listGetAll, setStr, getStr } from '@/src/lib/redis-store';
import { getUserActivityContext, recordUserActivity } from '../user-activity-context';

const userId = 'user-1';
const tenantId = 'tenant-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getUserActivityContext', () => {
  it('returns populated context when Redis has data', async () => {
    vi.mocked(listGetAll)
      .mockResolvedValueOnce([
        JSON.stringify({ id: 'm1', label: 'Mission Alpha', timestamp: 1000 }),
      ])
      .mockResolvedValueOnce([
        JSON.stringify({ id: 'n1', label: 'Host: 10.0.0.1', timestamp: 2000 }),
      ])
      .mockResolvedValueOnce([
        JSON.stringify({ id: 'f1', label: 'CVE-2024-1234 (Critical)', timestamp: 3000 }),
      ]);
    vi.mocked(getStr).mockResolvedValueOnce('1700000000000');

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx.recentMissions).toEqual([{ id: 'm1', label: 'Mission Alpha', timestamp: 1000 }]);
    expect(ctx.recentNodes).toEqual([{ id: 'n1', label: 'Host: 10.0.0.1', timestamp: 2000 }]);
    expect(ctx.recentFindings).toEqual([{ id: 'f1', label: 'CVE-2024-1234 (Critical)', timestamp: 3000 }]);
    expect(ctx.lastActiveAt).toBe(1700000000000);
  });

  it('returns empty struct when Redis returns empty lists', async () => {
    vi.mocked(listGetAll).mockResolvedValue([]);
    vi.mocked(getStr).mockResolvedValue(null);

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx).toEqual({ recentMissions: [], recentNodes: [], recentFindings: [], lastActiveAt: null });
  });

  it('returns empty struct when listGetAll throws', async () => {
    vi.mocked(listGetAll).mockRejectedValue(new Error('Redis down'));
    vi.mocked(getStr).mockRejectedValue(new Error('Redis down'));

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx).toEqual({ recentMissions: [], recentNodes: [], recentFindings: [], lastActiveAt: null });
  });

  it('silently skips malformed JSON entries', async () => {
    vi.mocked(listGetAll)
      .mockResolvedValueOnce(['not-json', JSON.stringify({ id: 'm2', label: 'Mission Beta', timestamp: 5000 })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    vi.mocked(getStr).mockResolvedValue(null);

    const ctx = await getUserActivityContext(userId, tenantId);

    expect(ctx.recentMissions).toEqual([{ id: 'm2', label: 'Mission Beta', timestamp: 5000 }]);
  });
});

describe('recordUserActivity', () => {
  it('calls listPrepend and setStr with correct keys', async () => {
    vi.mocked(listPrepend).mockResolvedValue();
    vi.mocked(setStr).mockResolvedValue();

    const item = { id: 'm1', label: 'Mission Alpha', timestamp: Date.now() };
    await recordUserActivity(userId, tenantId, 'mission', item);

    expect(listPrepend).toHaveBeenCalledWith(
      `useract:${tenantId}:${userId}:mission`,
      JSON.stringify(item),
      5,
      7 * 24 * 60 * 60,
    );
    expect(setStr).toHaveBeenCalledWith(
      `useract:${tenantId}:${userId}:lastActive`,
      expect.any(String),
      7 * 24 * 60 * 60,
    );
  });
});
