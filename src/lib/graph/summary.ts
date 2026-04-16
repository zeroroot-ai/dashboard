/**
 * Graph Summary
 *
 * Queries Neo4j for a tenant-level knowledge graph summary:
 * node counts by type, critical/high findings, recent missions.
 * Builds an LLM-friendly text summary for use in system prompts.
 *
 * Cached for 60 seconds per tenant to avoid repeated queries.
 */

import { getNeo4jDriver } from '@/src/lib/neo4j-client';
import type { Session } from 'neo4j-driver';

// ============================================================================
// Types
// ============================================================================

export interface GraphSummaryStats {
  hosts: number;
  services: number;
  findings: number;
  vulnerabilities: number;
  missions: number;
}

export interface GraphSummaryResponse {
  summary: string;
  stats: GraphSummaryStats;
}

interface CacheEntry {
  data: GraphSummaryResponse;
  timestamp: number;
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function getCached(tenantId: string): GraphSummaryResponse | null {
  const entry = cache.get(tenantId);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}

function setCache(tenantId: string, data: GraphSummaryResponse): void {
  cache.set(tenantId, { data, timestamp: Date.now() });
}

// ============================================================================
// Empty response
// ============================================================================

const EMPTY_STATS: GraphSummaryStats = {
  hosts: 0,
  services: 0,
  findings: 0,
  vulnerabilities: 0,
  missions: 0,
};

const EMPTY_RESPONSE: GraphSummaryResponse = {
  summary: '',
  stats: EMPTY_STATS,
};

// ============================================================================
// Helpers
// ============================================================================

function toNumber(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof (value as { toNumber: () => number }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return typeof value === 'number' ? value : 0;
}

// ============================================================================
// Core query
// ============================================================================

/**
 * Fetch a tenant-scoped knowledge graph summary.
 * Returns cached data if available (60s TTL).
 * Returns empty response on Neo4j failure (never throws).
 */
export async function getGraphSummary(tenantId: string): Promise<GraphSummaryResponse> {
  // Check cache first
  const cached = getCached(tenantId);
  if (cached) return cached;

  let session: Session | null = null;

  try {
    const driver = getNeo4jDriver();
    session = driver.session({ database: 'neo4j' });

    // 1. Node counts by label
    const countsResult = await session.run(
      `
      MATCH (n)
      WHERE n.tenant_id = $tenantId
      WITH labels(n)[0] AS label, count(n) AS cnt
      RETURN label, cnt
      `,
      { tenantId },
    );

    const countsByLabel: Record<string, number> = {};
    for (const record of countsResult.records) {
      const label = record.get('label') as string;
      const cnt = toNumber(record.get('cnt'));
      countsByLabel[label] = cnt;
    }

    const stats: GraphSummaryStats = {
      hosts: countsByLabel['Host'] ?? 0,
      services: countsByLabel['Service'] ?? 0,
      findings: countsByLabel['Finding'] ?? 0,
      vulnerabilities: countsByLabel['Vulnerability'] ?? 0,
      missions: countsByLabel['Mission'] ?? 0,
    };

    // 2. Critical/high findings with affected assets
    const findingsResult = await session.run(
      `
      MATCH (f)
      WHERE f.tenant_id = $tenantId
        AND (f:Finding OR f:Vulnerability)
        AND f.severity IN ['critical', 'high']
      OPTIONAL MATCH (f)-[:AFFECTS]->(a)
      RETURN f.name AS name, f.severity AS severity, f.cve AS cve,
             labels(a)[0] AS assetType, a.name AS assetName
      ORDER BY CASE f.severity WHEN 'critical' THEN 0 ELSE 1 END, f.name
      LIMIT 20
      `,
      { tenantId },
    );

    interface FindingRow {
      name: string;
      severity: string;
      cve: string | null;
      assetType: string | null;
      assetName: string | null;
    }

    const criticalFindings: FindingRow[] = findingsResult.records.map((record) => ({
      name: (record.get('name') as string) || 'Unknown',
      severity: (record.get('severity') as string) || 'high',
      cve: record.get('cve') as string | null,
      assetType: record.get('assetType') as string | null,
      assetName: record.get('assetName') as string | null,
    }));

    // 3. Recent missions
    const missionsResult = await session.run(
      `
      MATCH (m:Mission)
      WHERE m.tenant_id = $tenantId
      RETURN m.name AS name, m.status AS status
      ORDER BY m.created_at DESC
      LIMIT 5
      `,
      { tenantId },
    );

    interface MissionRow {
      name: string;
      status: string;
    }

    const recentMissions: MissionRow[] = missionsResult.records.map((record) => ({
      name: (record.get('name') as string) || 'Unnamed',
      status: (record.get('status') as string) || 'unknown',
    }));

    // Build LLM-friendly summary
    const summary = buildTextSummary(stats, countsByLabel, criticalFindings, recentMissions);

    const response: GraphSummaryResponse = { summary, stats };
    setCache(tenantId, response);
    return response;
  } catch (error) {
    console.warn('[GraphSummary] Failed to fetch graph summary, proceeding without:', error);
    return EMPTY_RESPONSE;
  } finally {
    if (session) {
      await session.close();
    }
  }
}

// ============================================================================
// Text summary builder
// ============================================================================

function buildTextSummary(
  stats: GraphSummaryStats,
  countsByLabel: Record<string, number>,
  criticalFindings: Array<{
    name: string;
    severity: string;
    cve: string | null;
    assetType: string | null;
    assetName: string | null;
  }>,
  recentMissions: Array<{ name: string; status: string }>,
): string {
  const totalNodes = Object.values(countsByLabel).reduce((sum, n) => sum + n, 0);

  if (totalNodes === 0) {
    return 'The knowledge graph is empty for this tenant. No hosts, findings, or missions have been recorded yet.';
  }

  const lines: string[] = [];

  // Overview
  lines.push('## Knowledge Graph Overview');
  lines.push(`Total entities: ${totalNodes}`);

  const labelSummary = Object.entries(countsByLabel)
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
  lines.push(`Breakdown: ${labelSummary}`);

  // Critical findings
  if (criticalFindings.length > 0) {
    lines.push('');
    lines.push('## Critical & High Severity Findings');
    for (const f of criticalFindings) {
      const cveStr = f.cve ? ` (${f.cve})` : '';
      const assetStr = f.assetName ? ` affecting ${f.assetType}: ${f.assetName}` : '';
      lines.push(`- [${f.severity.toUpperCase()}] ${f.name}${cveStr}${assetStr}`);
    }
  } else {
    lines.push('');
    lines.push('No critical or high severity findings recorded.');
  }

  // Recent missions
  if (recentMissions.length > 0) {
    lines.push('');
    lines.push('## Recent Missions');
    for (const m of recentMissions) {
      lines.push(`- ${m.name} (${m.status})`);
    }
  }

  return lines.join('\n');
}
