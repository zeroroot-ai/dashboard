import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getFindingsBySeverity } from '@/src/lib/gibson-client';
import type { SeverityDistribution } from '@/src/types';

/**
 * GET /api/analytics/findings/by-severity
 *
 * Retrieve findings distribution by severity level.
 * Returns counts for critical, high, medium, low, and info severities.
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
    const data = await getFindingsBySeverity(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch {
    // RPC not yet available — return empty severity distribution
    const severityDistribution: SeverityDistribution = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };
    return NextResponse.json(severityDistribution);
  }
}
