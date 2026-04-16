import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import neo4j from 'neo4j-driver';
import { getNeo4jDriver } from '@/src/lib/neo4j-client';
import type { Finding, PaginatedResponse } from '@/src/types';

/**
 * GET /api/findings
 *
 * Retrieve findings from Neo4j knowledge graph with filtering and pagination.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'findings:read')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions to view findings' } },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const severity = searchParams.get('severity');
    const missionId = searchParams.get('missionId');
    const search = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'No tenant associated with session' } },
        { status: 403 }
      );
    }

    const driver = getNeo4jDriver();
    const neo4jSession = driver.session({ database: 'neo4j' });

    try {
      // Query both Vulnerability and Finding nodes — tenant_id is always the first filter
      const cypher = `
        MATCH (n)
        WHERE (n:Vulnerability OR n:Finding)
        AND n.tenant_id = $tenantId
        ${severity ? 'AND n.severity = $severity' : ''}
        ${search ? 'AND (toLower(n.name) CONTAINS toLower($search) OR toLower(coalesce(n.description, "")) CONTAINS toLower($search))' : ''}
        OPTIONAL MATCH (m:Mission)-[*1..3]->(n)
        ${missionId ? 'WHERE m.id = $missionId AND m.tenant_id = $tenantId' : ''}
        RETURN n, labels(n) AS labels, collect(DISTINCT m.name)[0] AS missionName, collect(DISTINCT m.id)[0] AS mid
        ORDER BY CASE n.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END
        SKIP $offset LIMIT $limit
      `;

      const params: Record<string, any> = {
        offset: neo4j.int(offset),
        limit: neo4j.int(limit),
        tenantId,
      };
      if (severity) params.severity = severity;
      if (search) params.search = search;
      if (missionId) params.missionId = missionId;

      const result = await neo4jSession.run(cypher, params);

      // Count total — same tenant_id filter applied
      const countResult = await neo4jSession.run(
        `MATCH (n) WHERE (n:Vulnerability OR n:Finding)
         AND n.tenant_id = $tenantId
         ${severity ? 'AND n.severity = $severity' : ''}
         ${search ? 'AND (toLower(n.name) CONTAINS toLower($search) OR toLower(coalesce(n.description, "")) CONTAINS toLower($search))' : ''}
         RETURN count(n) AS total`,
        { tenantId, ...(severity ? { severity } : {}), ...(search ? { search } : {}) }
      );
      const total = countResult.records[0]?.get('total')?.toNumber?.() ?? 0;

      const findings: Finding[] = result.records.map((record) => {
        const n = record.get('n').properties;
        const labels = record.get('labels') as string[];
        const missionName = record.get('missionName');
        const mid = record.get('mid');

        return {
          id: n.id || record.get('n').elementId,
          missionId: mid || '',
          type: n.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
          title: n.name || 'Unknown',
          description: n.description || '',
          severity: n.severity || 'info',
          affectedAssets: n.affectedAssets || [],
          discoveredAt: n.discoveredAt || new Date().toISOString(),
          taxonomy: {},
          status: 'open',
          source: labels.includes('Vulnerability') ? 'vulnerability-scan' : 'agent',
          category: n.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
          missionName: missionName || undefined,
          cve: n.cve || undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      const response: PaginatedResponse<Finding> = {
        data: findings,
        total,
        page: Math.floor(offset / limit) + 1,
        limit,
        hasMore: offset + limit < total,
      };

      return NextResponse.json(response);
    } finally {
      await neo4jSession.close();
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process findings request', 500);
  }
}
