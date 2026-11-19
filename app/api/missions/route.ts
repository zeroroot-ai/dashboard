// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { listMissions, serializeMission } from '@/src/lib/gibson-client';
import type { Mission, MissionStatus, PaginatedResponse } from '@/src/types';
import { isActiveMission, parseMissionStatus } from '@/src/lib/missions/status';

/**
 * GET /api/missions
 *
 * List missions with optional filtering and pagination.
 *
 * Query parameters:
 * - status: Filter by status (submitted, working, input_required, paused, completed, failed, canceled)
 * - search: Search by mission name
 * - limit: Number of results to return (default: 50, max: 100)
 * - activeOnly: Return only active missions (default: false)
 *
 * Requires authentication and mission:read permission.
 */
export async function GET(request: NextRequest) {
  try {
    // Validate authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Authz enforced by daemon ext-authz on the listMissions RPC below.
    // The previous hasPermission() gate was a no-op since loadSchema() was
    // stubbed to empty after GetAuthSchema RPC was removed from the daemon.

    let tenantId: string;
    try {
      tenantId = await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const statusFilter = searchParams.get('status') as MissionStatus | null;
    const searchQuery = searchParams.get('search');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);
    const activeOnly = searchParams.get('activeOnly') === 'true';

    // Fetch missions from Gibson daemon
    const response = await listMissions(activeOnly, limit, session?.user?.id);

    // Convert protobuf missions to typed missions
    // Note: startTime and endTime from gRPC are Unix seconds, convert to JS Date (ms)
    let missions: Mission[] = response.missions.map((m) => {
      const serialized = serializeMission(m);
      return {
        id: serialized.id,
        name: serialized.name,
        status: parseMissionStatus(serialized.status),
        progress: calculateProgress(serialized),
        startedAt: serialized.startTime && serialized.startTime > 0 ? new Date(serialized.startTime * 1000) : undefined,
        completedAt: serialized.endTime && serialized.endTime > 0 ? new Date(serialized.endTime * 1000) : undefined,
        config: {},
        agents: [],
        findings: serialized.findingCount,
        events: 0,
        tenantId,
        missionDefinitionId: serialized.missionDefinitionId,
        createdBy: serialized.createdBy,
      };
    });

    // Apply client-side filtering
    if (statusFilter) {
      missions = missions.filter((m) => m.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      missions = missions.filter((m) =>
        m.name.toLowerCase().includes(query) || m.id.toLowerCase().includes(query)
      );
    }

    // hasMore is true when the daemon returned a full page, indicating additional
    // results may exist. The proto response does not include a total count or
    // next-page token, so we infer from the raw (pre-filter) response length.
    const rawCount = response.missions.length;

    const result: PaginatedResponse<Mission> = {
      data: missions,
      total: missions.length,
      page: 1,
      limit,
      hasMore: rawCount >= limit,
    };

    return NextResponse.json(result);
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}

/**
 * Calculate mission progress percentage
 */
function calculateProgress(mission: ReturnType<typeof serializeMission>): number {
  // If Gibson provides progress, use it
  if (mission.progress > 0) {
    return Math.round(mission.progress * 100);
  }

  // If completed or failed, return 100%
  if (mission.endTime && mission.endTime > 0) {
    return 100;
  }

  const status = parseMissionStatus(mission.status);

  // If active, estimate based on findings (simple heuristic)
  if (isActiveMission(status)) {
    // Return a dynamic progress between 10-90% based on findings
    return Math.min(90, 10 + mission.findingCount * 5);
  }

  // Paused missions keep their progress (default to 50% if unknown)
  if (status === 'paused') {
    return 50;
  }

  // Submitted missions have 0% progress
  return 0;
}
