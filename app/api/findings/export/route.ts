/**
 * Findings Export API Route
 *
 * POST /api/findings/export
 *
 * ExportFindings is DEFERRED per admin-services-completion spec (design.md
 * disposition table). The daemon stub returns Unimplemented; this route
 * returns 501 so callers know the feature is not yet available.
 *
 * The UI export button is replaced with a "Coming soon" disabled button.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';

export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // ExportFindings is deferred — the daemon TenantAdminService stub returns
    // Unimplemented. Return 501 so callers degrade gracefully.
    return NextResponse.json(
      { success: false, error: 'Export coming soon' },
      { status: 501 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'Export failed', 500);
  }
}
