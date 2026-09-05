import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';

/**
 * PATCH /api/alerts/mark-all-read
 *
 * In-app alerts feature is DEFERRED per admin-services-completion spec.
 * Returns a successful no-op response so any client-side optimistic update
 * does not surface an error.
 *
 * Requires authentication.
 */
export async function PATCH(request: NextRequest) {
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(request);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, count: 0, message: 'All alerts marked as read' });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
