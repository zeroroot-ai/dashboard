/**
 * Mission Clone API Route
 *
 * GET /api/missions/[id]/clone
 *
 * Returns the source YAML of a previously-created mission so the user can
 * pre-populate a new mission's authoring form ("Clone").
 *
 * Source-of-truth: the YAML is cached on the Neo4j Mission node by
 * `/api/missions/create` at create time. The daemon stores a structured
 * MissionDefinition (not YAML), so reconstituting YAML from it would require
 * a daemon-side serializer. Caching the original YAML on the Neo4j mirror
 * sidesteps that for missions created via the dashboard.
 *
 * Older missions created before this cache existed return 404 with a clear
 * message — operators may re-author them from scratch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getActiveTenant } from '@/src/lib/auth/active-tenant';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
      );
    }

    let tenantId: string;
    try {
      tenantId = await getActiveTenant();
    } catch {
      return NextResponse.json(
        { success: false, error: 'No active workspace' },
        { status: 403 },
      );
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Mission ID is required' },
        { status: 400 },
      );
    }

    const { getNeo4jDriver } = await import('@/src/lib/neo4j-client');
    const driver = getNeo4jDriver();
    const neo4jSession = driver.session({ database: 'neo4j' });
    try {
      // Tenant scoping is enforced via the Cypher MATCH — a user can only
      // clone missions that belong to their active tenant.
      const result = await neo4jSession.run(
        `MATCH (m:Mission {id: $id, tenant_id: $tenantId})
         RETURN m.name AS name, m.source_yaml AS sourceYaml`,
        { id, tenantId },
      );

      if (result.records.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Mission not found' },
          { status: 404 },
        );
      }

      const record = result.records[0];
      const name = record.get('name') as string | null;
      const sourceYaml = record.get('sourceYaml') as string | null;

      if (!sourceYaml) {
        // The mission predates the source-yaml cache (created before this
        // route was wired). Daemon-side YAML reconstruction is not yet
        // available; return a clear error rather than a silent empty form.
        return NextResponse.json(
          {
            success: false,
            error:
              'No cached YAML for this mission. Missions created before the source-yaml cache cannot be cloned automatically — please re-author from the editor.',
            name,
          },
          { status: 410 },
        );
      }

      return NextResponse.json({
        success: true,
        name,
        yaml: sourceYaml,
      });
    } finally {
      await neo4jSession.close();
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to clone mission', 500);
  }
}
