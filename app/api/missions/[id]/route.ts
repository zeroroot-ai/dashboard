import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { hasPermission } from '@/src/lib/auth/schema';
import { listMissions, serializeMission } from '@/src/lib/gibson-client';
import { getNeo4jDriver } from '@/src/lib/neo4j-client';
import type { Mission, MissionStatus } from '@/src/types';

/**
 * GET /api/missions/:id
 *
 * Fetch a single mission by ID. Queries Gibson daemon for mission data,
 * then enriches with graph data from Neo4j.
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

    if (!hasPermission(session, 'missions:read')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
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

    // Enrich with graph data from Neo4j (agents, hosts, findings count)
    let agents: string[] = [];
    let hosts: string[] = [];
    let graphFindingCount = 0;
    let target = '';
    let description = serialized.description || '';

    try {
      const driver = getNeo4jDriver();
      const neo4jSession = driver.session({ database: 'neo4j' });
      const tenantId = session.user.tenantId;

    try {
        const result = await neo4jSession.run(
          `MATCH (m:Mission {id: $id})
           WHERE m.tenant_id = $tenantId
           OPTIONAL MATCH (m)-[:USED_AGENT]->(a:Agent)
           OPTIONAL MATCH (m)-[:TARGETED]->(h:Host)
           OPTIONAL MATCH (m)-[*1..2]->(f:Finding)
           OPTIONAL MATCH (m)-[*1..2]->(v:Vulnerability)
           RETURN m,
             collect(DISTINCT a.name) AS agents,
             collect(DISTINCT h.name) AS hosts,
             count(DISTINCT f) + count(DISTINCT v) AS findingCount`,
          { id, tenantId: tenantId || '' }
        );

        if (result.records.length > 0) {
          const record = result.records[0];
          const m = record.get('m').properties;
          agents = (record.get('agents') as string[]).filter(Boolean);
          hosts = (record.get('hosts') as string[]).filter(Boolean);
          graphFindingCount = (record.get('findingCount') as any).toNumber?.() ?? record.get('findingCount');
          target = m.target || '';
          if (!description) {
            description = m.description || '';
          }
        }
      } finally {
        await neo4jSession.close();
      }
    } catch (neo4jErr) {
      console.warn('Neo4j enrichment failed:', neo4jErr);
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
      tenantId: session.user.tenantId || '',
    };

    return NextResponse.json(mission);
  } catch (error) {
    console.error('Failed to fetch mission:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch mission' } },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/missions/:id
 *
 * Delete a mission by ID. Only allowed for non-running missions.
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

    if (!hasPermission(session, 'missions:execute')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        { status: 403 }
      );
    }

    const { id } = await params;

    const deleteTenantId = session.user.tenantId;
    if (!deleteTenantId) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'No tenant associated with session' } },
        { status: 403 }
      );
    }

    const driver = getNeo4jDriver();
    const neo4jSession = driver.session({ database: 'neo4j' });

    try {
      // Check if mission exists, belongs to this tenant, and is not running
      const checkResult = await neo4jSession.run(
        `MATCH (m:Mission {id: $id}) WHERE m.tenant_id = $tenantId RETURN m.status AS status`,
        { id, tenantId: deleteTenantId }
      );

      if (checkResult.records.length === 0) {
        return NextResponse.json(
          { error: { code: 'NOT_FOUND', message: 'Mission not found' } },
          { status: 404 }
        );
      }

      const status = checkResult.records[0].get('status');
      if (status === 'running') {
        return NextResponse.json(
          { error: { code: 'BAD_REQUEST', message: 'Cannot delete a running mission. Stop it first.' } },
          { status: 400 }
        );
      }

      // Delete the mission and its relationships — tenant_id check prevents cross-tenant deletes
      await neo4jSession.run(
        `MATCH (m:Mission {id: $id})
         WHERE m.tenant_id = $tenantId
         OPTIONAL MATCH (m)-[r]-()
         DELETE r, m`,
        { id, tenantId: deleteTenantId }
      );

      return NextResponse.json({ success: true });
    } finally {
      await neo4jSession.close();
    }
  } catch (error) {
    console.error('Failed to delete mission:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to delete mission' } },
      { status: 500 }
    );
  }
}
