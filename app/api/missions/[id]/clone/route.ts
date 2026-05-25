/**
 * Mission Clone API Route
 *
 * GET /api/missions/[id]/clone
 *
 * DaemonService.GetMissionSourceYAML was removed in sdk#213 (the daemon
 * implementation was deleted in gibson#306). This route returns 410 Gone
 * for all requests until the clone feature is re-implemented against the
 * CUE source path (tracked at dashboard#338).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getActiveTenant } from '@/src/lib/auth/active-tenant';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params: _params }: RouteParams,
): Promise<NextResponse> {
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 },
    );
  }

  try {
    await getActiveTenant();
  } catch {
    return NextResponse.json(
      { success: false, error: 'No active workspace' },
      { status: 403 },
    );
  }

  return NextResponse.json(
    {
      success: false,
      error:
        'Mission cloning is temporarily unavailable. Re-open the CUE editor and author a new mission.',
      name: null,
    },
    { status: 410 },
  );
}
