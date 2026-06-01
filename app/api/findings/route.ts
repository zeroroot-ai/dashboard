import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { Finding, PaginatedResponse } from '@/src/types';

/**
 * GET /api/findings
 *
 * Retrieve findings from the knowledge graph with filtering and pagination.
 * Calls GraphService.GetFindings — routes through Envoy + ext-authz.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 11).
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

    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const searchParams = request.nextUrl.searchParams;
    const severity = searchParams.get('severity') ?? '';
    const category = searchParams.get('category') ?? '';
    const missionId = searchParams.get('missionId') ?? '';
    const search = searchParams.get('search') ?? '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const resp = await userClient(GraphService).getFindings({
      severityFilter: severity,
      categoryFilter: category,
      missionId,
      search,
      limit,
      offset,
    });

    const findings = resp.findings.map((f) => {
      const labels = f.labels;
      return {
        id: f.id,
        missionId: f.missionId || '',
        type: f.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
        title: f.name || 'Unknown',
        description: f.description || '',
        severity: (f.severity || 'info') as Finding['severity'],
        affectedAssets: [] as string[],
        discoveredAt: f.createdAt ? new Date(Number(f.createdAt.seconds) * 1000) : new Date(),
        taxonomy: {},
        status: 'open',
        source: labels.includes('Vulnerability') ? 'vulnerability-scan' : 'agent',
        category: f.type || (labels.includes('Vulnerability') ? 'vulnerability' : 'finding'),
        missionName: f.properties['missionName'] || undefined,
        cve: f.properties['cve'] || undefined,
        createdAt: f.createdAt ? new Date(Number(f.createdAt.seconds) * 1000) : new Date(),
        updatedAt: new Date(),
      };
    });

    const total = Number(resp.total);
    const response: PaginatedResponse<Finding> = {
      data: findings as Finding[],
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
      hasMore: offset + limit < total,
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof ConnectError) {
      if (error.code === Code.PermissionDenied || error.code === Code.Unauthenticated) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: error.message } },
          { status: 403 }
        );
      }
    }
    return daemonErrorResponse(error, { headers: request.headers });
  }
}
