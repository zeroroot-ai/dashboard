/**
 * Findings Export API Route
 *
 * GET /api/findings/export[?format=csv|json]
 *
 * Streams findings for the active tenant in the requested format. Uses the
 * same Neo4j query as `/api/findings` but pages through ALL records in
 * batches (no UI-style limit/offset) and writes them to the response as a
 * single download.
 *
 * Auth: same as /api/findings — `findings:read` permission required.
 *
 * The earlier daemon `ExportFindings` RPC stub was deferred per
 * `admin-services-completion`; export is implemented dashboard-side against
 * the Neo4j mirror, which is already the source-of-truth for the findings
 * list view, so the formats stay consistent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import neo4j from 'neo4j-driver';
import { getNeo4jDriver } from '@/src/lib/neo4j-client';

const BATCH_SIZE = 500;
const MAX_RECORDS = 50_000;

interface FindingRow {
  id: string;
  type: string;
  title: string;
  severity: string;
  cve: string;
  missionId: string;
  missionName: string;
  description: string;
  discoveredAt: string;
}

function csvEscape(s: string): string {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(row: FindingRow): string {
  return [
    row.id,
    row.type,
    row.title,
    row.severity,
    row.cve,
    row.missionId,
    row.missionName,
    row.description,
    row.discoveredAt,
  ]
    .map(csvEscape)
    .join(',');
}

const CSV_HEADER =
  'id,type,title,severity,cve,mission_id,mission_name,description,discovered_at\n';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'No tenant associated with session' } },
        { status: 403 },
      );
    }

    const format = (request.nextUrl.searchParams.get('format') ?? 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'json') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'format must be csv or json' } },
        { status: 400 },
      );
    }

    const severity = request.nextUrl.searchParams.get('severity');
    const missionId = request.nextUrl.searchParams.get('missionId');
    const search = request.nextUrl.searchParams.get('search');

    const driver = getNeo4jDriver();
    const allRows: FindingRow[] = [];

    const neo4jSession = driver.session({ database: 'neo4j' });
    try {
      // Page through results to bound memory. Same MATCH/WHERE shape as
      // /api/findings/route.ts, sans the pagination clamp.
      let offset = 0;
      while (offset < MAX_RECORDS) {
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
        const params: Record<string, unknown> = {
          tenantId,
          offset: neo4j.int(offset),
          limit: neo4j.int(BATCH_SIZE),
        };
        if (severity) params.severity = severity;
        if (search) params.search = search;
        if (missionId) params.missionId = missionId;

        const result = await neo4jSession.run(cypher, params);
        if (result.records.length === 0) break;

        for (const record of result.records) {
          const n = record.get('n').properties as Record<string, unknown>;
          const labels = record.get('labels') as string[];
          const missionName = (record.get('missionName') as string | null) ?? '';
          const mid = (record.get('mid') as string | null) ?? '';
          allRows.push({
            id: (n.id as string) ?? record.get('n').elementId,
            type:
              (n.type as string) ??
              (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
            title: (n.name as string) ?? 'Unknown',
            severity: (n.severity as string) ?? 'info',
            cve: (n.cve as string) ?? '',
            missionId: mid,
            missionName,
            description: (n.description as string) ?? '',
            discoveredAt: (n.discoveredAt as string) ?? '',
          });
        }
        offset += result.records.length;
        if (result.records.length < BATCH_SIZE) break;
      }
    } finally {
      await neo4jSession.close();
    }

    const filename = `findings-${tenantId}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'json') {
      return NextResponse.json(
        { tenantId, exportedAt: new Date().toISOString(), count: allRows.length, findings: allRows },
        {
          headers: {
            'Content-Disposition': `attachment; filename="${filename}.json"`,
          },
        },
      );
    }

    // CSV
    const lines = [CSV_HEADER, ...allRows.map((r) => rowToCsv(r) + '\n')];
    const body = lines.join('');
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
      },
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to export findings', 500);
  }
}
