/**
 * Mission Clone API Route
 *
 * GET /api/missions/[id]/clone
 *
 * Returns the source YAML of a previously-created mission so the user can
 * pre-populate a new mission's authoring form ("Clone").
 *
 * Source-of-truth: the daemon stores the YAML via the source_yaml field on
 * CreateMission (set by the dashboard at create time). The clone workflow
 * calls DaemonService.GetMissionSourceYAML to retrieve it.
 *
 * Missions created without YAML (programmatic path, or before the source_yaml
 * cache was wired) return 410 Gone — the handler returns codes.NotFound in
 * that case.
 *
 * Spec: dashboard-neo4j-crud-removal (Phase 3, Task 13).
 */

import { NextRequest, NextResponse } from 'next/server';
import { ConnectError, Code } from '@connectrpc/connect';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { getActiveTenant } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client';
import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
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

    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Mission ID is required' },
        { status: 400 },
      );
    }

    try {
      const resp = await userClient(DaemonService).getMissionSourceYAML({ missionId: id });

      return NextResponse.json({
        success: true,
        name: resp.missionName || null,
        yaml: resp.yaml,
      });
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        // The mission exists but has no cached YAML (programmatic creation or
        // created before source_yaml caching was wired). Return 410 Gone.
        return NextResponse.json(
          {
            success: false,
            error:
              'No cached YAML for this mission. Missions created before the source-yaml cache cannot be cloned automatically — please re-author from the editor.',
            name: null,
          },
          { status: 410 },
        );
      }
      throw err;
    }
  } catch (error) {
    return safeErrorResponse(error, 'Failed to clone mission', 500);
  }
}
