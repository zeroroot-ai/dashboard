import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';

/**
 * GET /api/missions/:id/findings
 *
 * Fetch findings and vulnerabilities associated with a mission via
 * GraphService.GetFindings with missionId filter.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 13).
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

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const { id } = await params;

    // GetFindings with missionId filter returns findings reachable from this
    // mission within 3 hops, same semantics as the prior Cypher traversal.
    const resp = await userClient(GraphService).getFindings({
      severityFilter: '',
      categoryFilter: '',
      missionId: id,
      search: '',
      limit: 500,
      offset: 0,
    });

    // Transform to the existing response shape: flat array of finding objects.
    const findings = resp.findings.map((f) => ({
      id: f.id,
      name: f.name || 'Unknown',
      type: f.type || (f.labels.includes('Vulnerability') ? 'vulnerability' : f.labels[0] ?? 'finding'),
      severity: f.severity || 'info',
      description: f.description || '',
      source: f.labels.includes('Vulnerability') ? (f.properties['cve'] || undefined) : 'agent',
    }));

    return NextResponse.json({ findings });
  } catch (error) {
    console.error('Failed to fetch mission findings:', error);
    return NextResponse.json({ findings: [] });
  }
}
