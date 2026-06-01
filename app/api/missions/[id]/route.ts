import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { listMissions, serializeMission, userClient, stopMission } from '@/src/lib/gibson-client';
import { GraphService } from '@/src/gen/gibson/graph/v1/graph_pb';
import type { Mission, MissionStatus } from '@/src/types';

/**
 * GET /api/missions/:id
 *
 * Fetch a single mission by ID. Queries Gibson daemon for mission data,
 * then enriches with graph data from GraphService.GetMissionGraph.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 12).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    let tenantId: string;
    try {
      tenantId = await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const { id } = await params;

    // Get mission from Gibson daemon
    const response = await listMissions(false, 1000, session?.user?.id);
    const gibsonMission = response.missions.find(m => m.id === id);

    if (!gibsonMission) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Mission not found' } },
        { status: 404 }
      );
    }

    const serialized = serializeMission(gibsonMission);

    // Map status
    const normalized = serialized.status.toLowerCase().replace('mission_status_', '');
    const status = (['pending', 'running', 'paused', 'completed', 'failed', 'stopped'].includes(normalized)
      ? normalized
      : 'pending') as MissionStatus;

    // Calculate progress
    let progress = 0;
    if (serialized.progress > 0) {
      progress = Math.round(serialized.progress * 100);
    } else if (serialized.endTime && serialized.endTime > 0) {
      progress = 100;
    } else if (status === 'running') {
      progress = Math.min(90, 10 + serialized.findingCount * 5);
    } else if (status === 'paused') {
      progress = 50;
    }

    // Enrich with graph data from GraphService.GetMissionGraph
    // Derive agents, hosts, and findings count by filtering response nodes by label.
    let agents: string[] = [];
    let hosts: string[] = [];
    let graphFindingCount = 0;
    let target = '';
    const description = serialized.description || '';

    try {
      const graphResp = await userClient(GraphService).getMissionGraph({ missionId: id });

      for (const node of graphResp.nodes) {
        if (node.labels.includes('Agent')) {
          const name = node.properties['name'] || node.id;
          if (name) agents.push(name);
        } else if (node.labels.includes('Host')) {
          const name = node.properties['name'] || node.id;
          if (name) hosts.push(name);
        } else if (node.labels.includes('Finding') || node.labels.includes('Vulnerability')) {
          graphFindingCount++;
        } else if (node.labels.includes('Target') || node.labels.includes('Mission')) {
          if (!target && node.properties['target']) {
            target = node.properties['target'];
          }
        }
      }

      // Deduplicate
      agents = [...new Set(agents)];
      hosts = [...new Set(hosts)];
    } catch (graphErr) {
      console.warn('GraphService.GetMissionGraph enrichment failed:', graphErr);
    }

    // Note: startTime and endTime from gRPC are Unix seconds, convert to JS Date (ms)
    const mission: Mission = {
      id: serialized.id,
      name: serialized.name || 'Unnamed Mission',
      status,
      progress,
      startedAt: serialized.startTime ? new Date(serialized.startTime * 1000) : undefined,
      completedAt: serialized.endTime && serialized.endTime > 0 ? new Date(serialized.endTime * 1000) : undefined,
      config: {
        target,
        description,
        hosts,
      },
      agents,
      findings: graphFindingCount || serialized.findingCount,
      events: 0,
      tenantId,
      missionDefinitionId: serialized.missionDefinitionId,
    };

    return NextResponse.json(mission);
  } catch (error) {
    console.warn('Failed to fetch mission:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch mission' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/missions/:id
 *
 * Stop a mission by ID. The daemon is authoritative; this calls StopMission
 * for running missions. The daemon-side Neo4j mirror is managed by the daemon.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 12).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CSRF — zero-trust-hardening Req 11.5
    try {
      await requireCsrf(request);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }

    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the downstream RPC.

    let deleteTenantId: string;
    try {
      deleteTenantId = await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const { id } = await params;

    // Find the mission via daemon — listMissions is the daemon source of truth.
    const missionListResp = await listMissions(false, 1000, session?.user?.id);
    const mission = missionListResp.missions.find(m => m.id === id);

    if (!mission) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Mission not found' } },
        { status: 404 }
      );
    }

    const missionStatus = mission.status?.toLowerCase().replace('mission_status_', '') || '';
    if (missionStatus === 'running') {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'Cannot delete a running mission. Stop it first.' } },
        { status: 400 }
      );
    }

    // Daemon does not yet expose a delete RPC; stop is the closest operation.
    // The daemon-side Neo4j mirror is managed by the daemon.
    // For stopped/completed/failed missions this is a no-op at the daemon level.
    try {
      await stopMission(id, false, session?.user?.id, deleteTenantId);
    } catch {
      // Ignore stop errors for non-running missions — already stopped.
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete mission:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to delete mission' } },
      { status: 500 }
    );
  }
}
