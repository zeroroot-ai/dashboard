import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { getKPIs } from '@/src/lib/gibson-client';
import type { KPIData } from '@/src/types';

/**
 * GET /api/analytics/kpis
 *
 * Retrieve KPI data for the dashboard home page.
 * Includes mission statistics, agent utilization, findings summary, and trends.
 *
 * Requires authentication and findings:read permission.
 */
export async function GET(request: NextRequest) {
  // Validate authentication
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  // Check permissions
  if (!hasPermission(session, 'findings:read')) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No tenant context in session' } },
      { status: 401 }
    );
  }

  try {
    const data = await getKPIs(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch {
    // RPC not yet available — return zero-valued KPIs
    const kpiData: KPIData = {
      totalMissions: {
        allTime: 0,
        thisMonth: 0,
        thisWeek: 0,
      },
      activeMissions: 0,
      missionSuccessRate: 0,
      averageMissionDuration: 0,
      agentUtilization: {
        busy: 0,
        idle: 0,
        percentage: 0,
      },
      findingsSummary: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      newFindingsTrend: {
        last24h: 0,
        previous24h: 0,
        changePercent: 0,
      },
      criticalFindingsAged: 0,
    };
    return NextResponse.json(kpiData);
  }
}
