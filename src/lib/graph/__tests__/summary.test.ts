import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock gibson-client before importing the module under test.
// summary.ts calls userClient(GraphService).getGraphSummary({}).
const mockGetGraphSummary = vi.fn();

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => ({
    getGraphSummary: mockGetGraphSummary,
  })),
}));

// Import after mocking
import { getGraphSummary } from '../summary';

describe('getGraphSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stats and summary from daemon response', async () => {
    mockGetGraphSummary.mockResolvedValueOnce({
      summary: '## Knowledge Graph Overview\nTotal entities: 45',
      stats: {
        hosts: BigInt(10),
        services: BigInt(25),
        findings: BigInt(5),
        vulnerabilities: BigInt(3),
        missions: BigInt(2),
      },
    });

    const result = await getGraphSummary('tenant-1');

    expect(result.stats.hosts).toBe(10);
    expect(result.stats.services).toBe(25);
    expect(result.stats.findings).toBe(5);
    expect(result.stats.vulnerabilities).toBe(3);
    expect(result.stats.missions).toBe(2);
    expect(result.summary).toContain('Knowledge Graph Overview');
  });

  it('returns empty response when RPC fails', async () => {
    mockGetGraphSummary.mockRejectedValueOnce(new Error('unavailable'));

    const result = await getGraphSummary('tenant-fail');

    expect(result.summary).toBe('');
    expect(result.stats.hosts).toBe(0);
    expect(result.stats.findings).toBe(0);
  });

  it('handles missing stats field gracefully', async () => {
    mockGetGraphSummary.mockResolvedValueOnce({
      summary: 'no stats',
      stats: undefined,
    });

    const result = await getGraphSummary('tenant-no-stats');

    expect(result.summary).toBe('no stats');
    expect(result.stats.hosts).toBe(0);
    expect(result.stats.findings).toBe(0);
  });
});
