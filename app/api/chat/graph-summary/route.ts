/**
 * Graph Summary API Route
 *
 * GET /api/chat/graph-summary - Tenant-scoped knowledge graph summary for chatbot context.
 * Returns node counts, critical/high findings, and recent missions.
 * Cached for 60 seconds per tenant.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { getGraphSummary, type GraphSummaryResponse } from '@/src/lib/graph/summary';

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(): Promise<Response> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let tenantId: string;
    try {
      tenantId = await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }
    const summary = await getGraphSummary(tenantId);

    return NextResponse.json(summary);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
