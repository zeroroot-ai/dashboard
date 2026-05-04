import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import {
  getStatus,
  serializeStatus,
  listMissions,
  listAgents,
  getFindingsBySeverity,
} from '@/src/lib/gibson-client';
import type { DashboardMetrics, ComponentStatus } from '@/src/types';

/**
 * GET /api/status
 *
 * Returns dashboard metrics including:
 * - Active missions count with trend
 * - Total findings by severity (via GraphService.GetFindingCounts)
 * - Agent activity statistics
 * - System health status
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 11).
 */
export async function GET() {
  // Validate authentication
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 }
    );
  }

  const tenantId = session.user.tenantId ?? undefined;

  // Fetch data from Gibson daemon — each call falls back to empty data on failure
  const [statusResponse, , agentsResponse] = await Promise.all([
    getStatus(session?.user?.id, session?.user?.tenantId ?? undefined).catch(() => null),
    listMissions(true, 100, session?.user?.id).catch(() => ({ missions: [] })),
    listAgents(undefined, session?.user?.id).catch(() => ({ agents: [] })),
  ]);

  const status = statusResponse
    ? serializeStatus(statusResponse)
    : {
        running: false,
        pid: 0,
        startTime: 0,
        uptime: '',
        grpcAddress: '',
        registryType: '',
        registryAddr: '',
        callbackAddr: '',
        agentCount: 0,
        missionCount: 0,
        activeMissionCount: 0,
      };

  // Calculate agent health statistics
  const agentsByStatus = agentsResponse.agents.reduce(
    (acc, agent) => {
      const healthStatus = mapHealthToStatus(agent.health);
      acc[healthStatus] = (acc[healthStatus] || 0) + 1;
      return acc;
    },
    {} as Record<ComponentStatus, number>
  );

  const activeAgents = agentsResponse.agents.filter(
    (a) => a.health === 'HEALTH_HEALTHY' || a.health === 'HEALTH_DEGRADED'
  ).length;

  // Determine overall system health
  const unhealthyCount = agentsByStatus.unhealthy || 0;
  const degradedCount = agentsByStatus.degraded || 0;
  const overallHealth: ComponentStatus =
    unhealthyCount > 0
      ? 'unhealthy'
      : degradedCount > 0
      ? 'degraded'
      : statusResponse
      ? 'healthy'
      : 'unknown';

  // Fetch real finding counts via GraphService.GetFindingCounts (same as /api/findings/counts)
  const defaults = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const findingsBySeverity = tenantId
    ? await getFindingsBySeverity(tenantId, session?.user?.id).then((counts) => ({
        ...defaults,
        ...Object.fromEntries(
          Object.entries(counts).filter(([k]) => k in defaults)
        ),
      }))
    : defaults;

  const metrics: DashboardMetrics = {
    activeMissions: {
      current: status.activeMissionCount,
      trend: 'stable',
      previousValue: status.activeMissionCount,
      percentChange: 0,
    },
    totalFindings: {
      current: Object.values(findingsBySeverity).reduce((sum, n) => sum + n, 0),
      trend: 'stable',
      previousValue: 0,
      percentChange: 0,
      bySeverity: findingsBySeverity,
    },
    agentActivity: {
      active: activeAgents,
      total: status.agentCount,
      byStatus: {
        healthy: agentsByStatus.healthy || 0,
        degraded: agentsByStatus.degraded || 0,
        unhealthy: agentsByStatus.unhealthy || 0,
        unknown: agentsByStatus.unknown || 0,
      },
    },
    systemHealth: {
      overall: overallHealth,
      components: {
        daemon: status.running ? 'healthy' : 'unhealthy',
        agents: activeAgents > 0 ? 'healthy' : 'degraded',
        registry: status.registryType ? 'healthy' : 'unknown',
      },
    },
  };

  return NextResponse.json({
    data: metrics,
    timestamp: new Date(),
  });
}

/**
 * Map Gibson health enum to ComponentStatus
 */
function mapHealthToStatus(health: string): ComponentStatus {
  switch (health) {
    case 'HEALTH_HEALTHY':
      return 'healthy';
    case 'HEALTH_DEGRADED':
      return 'degraded';
    case 'HEALTH_UNHEALTHY':
      return 'unhealthy';
    default:
      return 'unknown';
  }
}
