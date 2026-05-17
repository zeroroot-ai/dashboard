import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';

/**
 * GET /api/alerts
 *
 * In-app alerts feature is DEFERRED per admin-services-completion spec.
 * No alert producer exists; the daemon ListAlerts RPC stub returns
 * Unimplemented. This route returns an empty list so the UI degrades
 * gracefully rather than surfacing an error.
 *
 * Requires authentication.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    return NextResponse.json({ alerts: [], total: 0 });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
