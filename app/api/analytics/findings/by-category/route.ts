import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { getFindingsByCategory } from '@/src/lib/gibson-client';
import type { CategoryCount } from '@/src/types';

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

  // Check permissions
  if (!hasPermission(session, 'findings:read')) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
      { status: 403 }
    );
  }

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
  } catch {
    // RPC not yet available — return empty category list
    const categories: CategoryCount[] = [];
    return NextResponse.json(categories);
  }
}
