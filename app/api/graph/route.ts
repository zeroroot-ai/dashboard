/**
 * Full Graph API Route
 *
 * GET /api/graph - Fetch full knowledge graph with optional filters
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getFullGraph } from '@/src/lib/neo4j-client';

export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const nodeTypes = searchParams.get('nodeTypes')?.split(',');
    const relationshipTypes = searchParams.get('relationshipTypes')?.split(',');
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.get('limit')
      ? parseInt(searchParams.get('limit')!)
      : 500;

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with session' }, { status: 403 });
    }

    // Build filter options
    const labels = nodeTypes || [];

    // Fetch graph data from Neo4j — tenantId is mandatory for data isolation
    const graphData = await getFullGraph(tenantId, {
      labels,
      search,
      limit,
    });

    // Filter edges by relationship type if specified
    let edges = graphData.edges;
    if (relationshipTypes && relationshipTypes.length > 0) {
      edges = graphData.edges.filter((edge) =>
        relationshipTypes.includes(edge.type)
      );
    }

    return NextResponse.json({
      nodes: graphData.nodes,
      edges,
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process graph request', 500);
  }
}
