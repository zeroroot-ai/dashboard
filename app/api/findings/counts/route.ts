import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getNeo4jDriver } from '@/src/lib/neo4j-client';
import { safeErrorResponse } from '@/src/lib/api-errors';

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant context' }, { status: 403 });
    }

    const driver = getNeo4jDriver();
    const neo4jSession = driver.session({ database: 'neo4j' });

    try {
      const result = await neo4jSession.run(`
        MATCH (n) WHERE (n:Vulnerability OR n:Finding)
        AND n.tenant_id = $tenantId
        RETURN n.severity AS severity, count(n) AS count
      `, { tenantId });

      const counts: Record<string, number> = {
        critical: 0, high: 0, medium: 0, low: 0, info: 0,
      };

      for (const record of result.records) {
        const sev = record.get('severity') as string;
        const count = record.get('count').toNumber?.() ?? record.get('count');
        if (sev && sev in counts) {
          counts[sev] = count;
        }
      }

      return NextResponse.json(counts);
    } finally {
      await neo4jSession.close();
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch finding counts', 500);
  }
}
