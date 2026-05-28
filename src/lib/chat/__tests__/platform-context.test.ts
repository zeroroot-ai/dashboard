import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/src/lib/gibson-client', () => ({
  listAgents: vi.fn(),
  listTools: vi.fn(),
  listPlugins: vi.fn(),
}));

import { listAgents, listTools, listPlugins } from '@/src/lib/gibson-client';
import { getPlatformContext } from '../platform-context';

const userId = 'user-1';
const tenantId = 'tenant-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPlatformContext', () => {
  it('returns populated context when all RPCs succeed', async () => {
    vi.mocked(listAgents).mockResolvedValueOnce({
      agents: [
        { id: 'a1', name: 'recon-agent', kind: 'agent', health: 'healthy', version: '1.0.0', endpoint: '', capabilities: [], lastSeen: BigInt(0) },
        { id: 'a2', name: 'exploit-agent', kind: 'agent', health: 'degraded', version: '1.0.0', endpoint: '', capabilities: [], lastSeen: BigInt(0) },
      ],
    } as never);
    vi.mocked(listTools).mockResolvedValueOnce({
      tools: [
        { id: 't1', name: 'nmap', version: '7.95', endpoint: '', description: '', health: 'healthy', lastSeen: BigInt(0) },
        { id: 't2', name: 'nuclei', version: '3.2.0', endpoint: '', description: '', health: 'healthy', lastSeen: BigInt(0) },
        { id: 't3', name: 'ffuf', version: '2.1.0', endpoint: '', description: '', health: 'healthy', lastSeen: BigInt(0) },
      ],
    } as never);
    vi.mocked(listPlugins).mockResolvedValueOnce({
      plugins: [
        { id: 'p1', name: 'debug-plugin', version: '0.4.1', endpoint: '', description: '', health: 'healthy', lastSeen: BigInt(0) },
      ],
    } as never);

    const ctx = await getPlatformContext(userId, tenantId);

    expect(ctx.agents).toHaveLength(2);
    expect(ctx.agents[0]).toEqual({ id: 'a1', name: 'recon-agent', kind: 'agent', health: 'healthy' });
    expect(ctx.tools).toHaveLength(3);
    expect(ctx.tools[0]).toEqual({ name: 'nmap', version: '7.95' });
    expect(ctx.plugins).toHaveLength(1);
    expect(ctx.plugins[0]).toEqual({ name: 'debug-plugin', version: '0.4.1', health: 'healthy' });
  });

  it('returns empty arrays when all RPCs throw', async () => {
    vi.mocked(listAgents).mockRejectedValueOnce(new Error('gRPC unavailable'));
    vi.mocked(listTools).mockRejectedValueOnce(new Error('gRPC unavailable'));
    vi.mocked(listPlugins).mockRejectedValueOnce(new Error('gRPC unavailable'));

    const ctx = await getPlatformContext(userId, tenantId);

    expect(ctx).toEqual({ agents: [], tools: [], plugins: [] });
  });

  it('populates successful slots when one RPC fails', async () => {
    vi.mocked(listAgents).mockRejectedValueOnce(new Error('timeout'));
    vi.mocked(listTools).mockResolvedValueOnce({
      tools: [{ id: 't1', name: 'nmap', version: '7.95', endpoint: '', description: '', health: 'healthy', lastSeen: BigInt(0) }],
    } as never);
    vi.mocked(listPlugins).mockResolvedValueOnce({ plugins: [] } as never);

    const ctx = await getPlatformContext(userId, tenantId);

    expect(ctx.agents).toEqual([]);
    expect(ctx.tools).toHaveLength(1);
    expect(ctx.plugins).toEqual([]);
  });
});
