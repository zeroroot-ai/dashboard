import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getFindingsByCategory } from '@/src/lib/gibson-client';
import { logger } from '@/src/lib/logger';

/**
 * GET /api/analytics/findings/by-category
 *
 * Retrieve top finding categories with severity breakdown.
 * Returns findings grouped by MITRE ATT&CK categories or taxonomy.
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
    const data = await getFindingsByCategory(tenantId, session?.user?.id);
    return NextResponse.json(data);
  } catch (err) {
    logger.error(
      { err, route: 'analytics/findings/by-category' },
      'analytics RPC failed',
    );
    return NextResponse.json(
      {
        error: {
          code: 'UPSTREAM_UNAVAILABLE',
          message: 'Data temporarily unavailable.',
        },
      },
      { status: 503 },
    );
  }
}
