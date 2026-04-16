import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Neo4j driver before importing the module under test
const mockRun = vi.fn();
const mockClose = vi.fn();
const mockSession = {
  run: mockRun,
  close: mockClose,
};
const mockDriver = {
  session: vi.fn(() => mockSession),
};

vi.mock('@/src/lib/neo4j-client', () => ({
  getNeo4jDriver: vi.fn(() => mockDriver),
}));

// Import after mocking
import { getGraphSummary } from '../summary';

describe('getGraphSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the module-level cache by re-importing would be complex,
    // so we test with different tenant IDs to avoid cache hits
  });

  it('returns stats and summary for a tenant with data', async () => {
    const tenantId = `tenant-${Date.now()}-1`;

    // Mock node counts query
    mockRun.mockResolvedValueOnce({
      records: [
        { get: (key: string) => (key === 'label' ? 'Host' : 10) },
        { get: (key: string) => (key === 'label' ? 'Service' : 25) },
        { get: (key: string) => (key === 'label' ? 'Finding' : 5) },
        { get: (key: string) => (key === 'label' ? 'Vulnerability' : 3) },
        { get: (key: string) => (key === 'label' ? 'Mission' : 2) },
      ],
    });

    // Mock critical findings query
    mockRun.mockResolvedValueOnce({
      records: [
        {
          get: (key: string) => {
            const data: Record<string, string | null> = {
              name: 'SQL Injection',
              severity: 'critical',
              cve: 'CVE-2026-1234',
              assetType: 'Host',
              assetName: '10.0.0.1',
            };
            return data[key] ?? null;
          },
        },
      ],
    });

    // Mock recent missions query
    mockRun.mockResolvedValueOnce({
      records: [
        {
          get: (key: string) => {
            const data: Record<string, string> = { name: 'Full Scan', status: 'completed' };
            return data[key];
          },
        },
      ],
    });

    const result = await getGraphSummary(tenantId);

    expect(result.stats.hosts).toBe(10);
    expect(result.stats.services).toBe(25);
    expect(result.stats.findings).toBe(5);
    expect(result.stats.vulnerabilities).toBe(3);
    expect(result.stats.missions).toBe(2);
    expect(result.summary).toContain('Knowledge Graph Overview');
    expect(result.summary).toContain('SQL Injection');
    expect(result.summary).toContain('Full Scan');
  });

  it('filters all queries by tenant_id', async () => {
    const tenantId = `tenant-${Date.now()}-2`;

    // Return empty results
    mockRun.mockResolvedValue({ records: [] });

    await getGraphSummary(tenantId);

    // All 3 queries should have been called
    expect(mockRun).toHaveBeenCalledTimes(3);

    // Each query should contain tenant_id filter
    for (const call of mockRun.mock.calls) {
      const query = call[0] as string;
      expect(query).toContain('tenant_id');
      const params = call[1] as Record<string, string>;
      expect(params.tenantId).toBe(tenantId);
    }
  });

  it('returns empty summary when Neo4j fails', async () => {
    const tenantId = `tenant-${Date.now()}-3`;

    mockDriver.session.mockImplementationOnce(() => {
      throw new Error('Connection refused');
    });

    const result = await getGraphSummary(tenantId);

    expect(result.summary).toBe('');
    expect(result.stats.hosts).toBe(0);
    expect(result.stats.findings).toBe(0);
  });

  it('returns cached data within 60s window', async () => {
    const tenantId = `tenant-${Date.now()}-4`;

    // First call: return data
    mockRun.mockResolvedValueOnce({
      records: [{ get: (key: string) => (key === 'label' ? 'Host' : 5) }],
    });
    mockRun.mockResolvedValueOnce({ records: [] });
    mockRun.mockResolvedValueOnce({ records: [] });

    const first = await getGraphSummary(tenantId);
    const callCountAfterFirst = mockRun.mock.calls.length;

    // Second call should use cache — no additional Neo4j queries
    const second = await getGraphSummary(tenantId);

    expect(mockRun.mock.calls.length).toBe(callCountAfterFirst);
    expect(second.stats.hosts).toBe(first.stats.hosts);
  });
});
