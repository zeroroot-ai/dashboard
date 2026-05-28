import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// Mock config to inject test Langfuse credentials
vi.mock('@/src/lib/config', () => ({
  serverConfig: {
    langfuseHost: 'http://langfuse.test',
    langfuseAdminPublicKey: 'pk-test',
    langfuseAdminSecretKey: 'sk-test',
  },
}));

import { getLangfuseUserContext } from '../langfuse-session-context';
import { LangfuseClient } from '@/src/lib/langfuse-client';

const userId = 'user-1';
const tenantId = 'tenant-1';

const mockTrace = {
  id: 'trace-1',
  name: 'recon-agent-run',
  timestamp: '2026-05-28T10:00:00Z',
  metadata: {},
  output: 'Found 12 open ports on target.',
  tags: [],
  totalTokens: 450,
  promptTokens: 200,
  completionTokens: 250,
  latency: 1200,
  observations: [],
  userId,
  sessionId: 'sess-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLangfuseUserContext', () => {
  it('returns trace summaries on happy path', async () => {
    vi.spyOn(LangfuseClient.prototype, 'listTraces').mockResolvedValueOnce([mockTrace]);

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx.recentTraces).toHaveLength(1);
    expect(ctx.recentTraces[0]).toMatchObject({
      name: 'recon-agent-run',
      startTime: '2026-05-28T10:00:00Z',
      status: 'ok',
      totalTokens: 450,
    });
    expect(ctx.recentTraces[0].outputSnippet).toBe('Found 12 open ports on target.');
  });

  it('truncates long output snippets to 200 characters', async () => {
    const longOutput = 'x'.repeat(300);
    vi.spyOn(LangfuseClient.prototype, 'listTraces').mockResolvedValueOnce([
      { ...mockTrace, output: longOutput },
    ]);

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx.recentTraces[0].outputSnippet).toHaveLength(200);
  });

  it('returns empty context when listTraces throws (auth error)', async () => {
    vi.spyOn(LangfuseClient.prototype, 'listTraces').mockRejectedValueOnce(
      new Error('401 Unauthorized'),
    );

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx).toEqual({ recentTraces: [] });
  });

  it('returns empty context when listTraces throws (unavailable)', async () => {
    vi.spyOn(LangfuseClient.prototype, 'listTraces').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED'),
    );

    const ctx = await getLangfuseUserContext(userId, tenantId);

    expect(ctx).toEqual({ recentTraces: [] });
  });

  it('returns empty context when no credentials configured', async () => {
    // Re-mock config with missing credentials
    vi.doMock('@/src/lib/config', () => ({
      serverConfig: {
        langfuseHost: null,
        langfuseAdminPublicKey: '',
        langfuseAdminSecretKey: '',
      },
    }));

    // Force re-import with new mock
    const { getLangfuseUserContext: fn } = await import('../langfuse-session-context');
    const ctx = await fn(userId, tenantId);

    expect(ctx).toEqual({ recentTraces: [] });
  });
});
