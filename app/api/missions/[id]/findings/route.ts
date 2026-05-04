import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getLegacyNeo4jDriver } from '@/src/lib/neo4j-legacy-driver';

/**
 * GET /api/missions/:id/findings
 *
 * Fetch findings and vulnerabilities associated with a mission from Neo4j.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with session' }, { status: 403 });
    }

    const driver = getLegacyNeo4jDriver();
    const neo4jSession = driver.session({ database: 'neo4j' });

    try {
      const result = await neo4jSession.run(
        `MATCH (m:Mission {id: $id})
         WHERE m.tenant_id = $tenantId
         OPTIONAL MATCH (m)-[*1..3]->(v:Vulnerability)
         WHERE v.tenant_id = $tenantId
         OPTIONAL MATCH (m)-[*1..3]->(f:Finding)
         WHERE f.tenant_id = $tenantId
         WITH collect(DISTINCT {
           id: v.id,
           name: v.name,
           type: 'vulnerability',
           severity: v.severity,
           description: v.description,
           source: v.cve
         }) AS vulns,
         collect(DISTINCT {
           id: f.id,
           name: f.name,
           type: f.type,
           severity: f.severity,
           description: f.description,
           source: 'agent'
         }) AS finds
         RETURN vulns + finds AS findings`,
        { id, tenantId }
      );

      const findings = result.records.length > 0
        ? (result.records[0].get('findings') as any[]).filter((f: any) => f.id !== null)
        : [];

      return NextResponse.json({ findings });
    } finally {
      await neo4jSession.close();
    }
  } catch (error) {
    console.error('Failed to fetch mission findings:', error);
    return NextResponse.json({ findings: [] });
  }
}
