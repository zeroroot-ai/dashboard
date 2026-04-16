/**
 * Mission Graph API Route
 *
 * GET /api/graph/mission/:id - Fetch knowledge graph for a specific mission
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getMissionGraph } from '@/src/lib/neo4j-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const missionId = id;

    if (!missionId) {
      return NextResponse.json(
        { error: 'Mission ID is required' },
        { status: 400 }
      );
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with session' }, { status: 403 });
    }

    // Fetch mission graph from Neo4j — tenantId enforces data isolation
    const graphData = await getMissionGraph(missionId, tenantId);

    return NextResponse.json(graphData);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process graph request', 500);
  }
}
