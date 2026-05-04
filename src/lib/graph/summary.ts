/**
 * Graph Summary
 *
 * Fetches a tenant-level knowledge graph summary from the daemon via
 * GraphService.GetGraphSummary. The daemon performs the Neo4j query and
 * caches the result for 60 seconds server-side — no client-side cache needed.
 *
 * Spec: dashboard-direct-neo4j-removal (Phase 3, Task 10).
 */

import 'server-only';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';

// ============================================================================
// Types (public interface unchanged)
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

// ============================================================================
// Empty response (fallback on error)
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
// Core function
// ============================================================================

/**
 * Fetch a tenant-scoped knowledge graph summary from the daemon.
 * Caching (60s TTL, per-tenant) is handled server-side by GetGraphSummary.
 * Returns empty response on failure — never throws.
 */
export async function getGraphSummary(_tenantId: string): Promise<GraphSummaryResponse> {
  try {
    const resp = await userClient(GraphService).getGraphSummary({});
    const s = resp.stats;
    const stats: GraphSummaryStats = {
      hosts: s ? Number(s.hosts) : 0,
      services: s ? Number(s.services) : 0,
      findings: s ? Number(s.findings) : 0,
      vulnerabilities: s ? Number(s.vulnerabilities) : 0,
      missions: s ? Number(s.missions) : 0,
    };
    return { summary: resp.summary, stats };
  } catch (error) {
    console.warn('[GraphSummary] Failed to fetch graph summary, proceeding without:', error);
    return EMPTY_RESPONSE;
  }
}
