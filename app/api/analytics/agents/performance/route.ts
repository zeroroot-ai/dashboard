import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getAgentPerformance } from '@/src/lib/gibson-client';
import type { AgentPerformance } from '@/src/types';

/**
 * GET /api/analytics/agents/performance
 *
 * Retrieve agent performance comparison data.
 * Includes execution counts, timing, success rates, and current status.
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

  // Authz enforced by daemon ext-authz on the downstream RPC.

  const tenantId = session.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'No tenant context in session' } },
      { status: 401 }
    );
  }

  try {
    const data = await getAgentPerformance(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch {
    // RPC not yet available — return empty agent performance list
    const agentPerformance: AgentPerformance[] = [];
    return NextResponse.json(agentPerformance);
  }
}
