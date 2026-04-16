/**
 * Graph Statistics API Route
 *
 * GET /api/graph/stats - Fetch knowledge graph statistics
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getGraphStats } from '@/src/lib/neo4j-client';

export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenantId = session.user.tenantId;
    if (!tenantId) {
      return NextResponse.json({ error: 'No tenant associated with session' }, { status: 403 });
    }

    // Fetch graph statistics from Neo4j — tenantId enforces data isolation
    const stats = await getGraphStats(tenantId);

    return NextResponse.json(stats);
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process graph request', 500);
  }
}
