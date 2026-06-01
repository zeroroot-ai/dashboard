import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockListTraces = vi.fn();

vi.mock('@/src/lib/gibson-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    userClient: vi.fn().mockReturnValue({
      listTraces: (...args: unknown[]) => mockListTraces(...args),
    }),
    timestampToISO: actual.timestampToISO,
  };
});

import { getLangfuseUserContext } from '../langfuse-session-context';

const userId = 'user-1';
const tenantId = 'tenant-1';

function makeTraceRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trace-1',
    name: 'recon-agent-run',
    timestamp: { seconds: BigInt(1748433600), nanos: 0 },
    tags: [],
    userId,
    sessionId: 'sess-1',
    totalTokens: BigInt(450),
    promptTokens: BigInt(200),
    completionTokens: BigInt(250),
    latencyMs: 1200,
    observationIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListTraces.mockResolvedValue({ traces: [], nextPageToken: '', totalItems: BigInt(0) });
});

describe('getLangfuseUserContext', () => {
  it('returns trace summaries on happy path', async () => {
    mockListTraces.mockResolvedValueOnce({
      traces: [makeTraceRecord()],
      nextPageToken: '',
      totalItems: BigInt(1),
    });

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx.recentTraces).toHaveLength(1);
    expect(ctx.recentTraces[0]).toMatchObject({
      name: 'recon-agent-run',
      status: 'ok',
      totalTokens: 450,
    });
  });

  it('returns empty context when listTraces throws', async () => {
    mockListTraces.mockRejectedValueOnce(new Error('daemon unavailable'));

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx).toEqual({ recentTraces: [] });
  });

  it('returns empty context when listTraces returns empty', async () => {
    mockListTraces.mockResolvedValueOnce({
      traces: [],
      nextPageToken: '',
      totalItems: BigInt(0),
    });

    const ctx = await getLangfuseUserContext(userId, tenantId);
    expect(ctx).toEqual({ recentTraces: [] });
  });
});
