// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { isInvalidArgument, walkPages } from '@/src/lib/gibson-client/paging';
import { activityOfFinding } from '@/src/lib/findings/activity';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/finding-activity?finding=ID
 *
 * The events of one finding on the Timeline, and its exposure window split
 * into agent time and wait time (WorldService.GetTimeline and GetExposure,
 * gibson#1467). GetTimeline has no filter by finding, so the route reads the
 * Timeline of the tenant and keeps the events of the finding. `truncated` is
 * true when the read stopped at the page bound before the end of the Timeline.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }
    const findingId = req.nextUrl.searchParams.get('finding') ?? '';
    if (!findingId) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'The finding parameter is required' } },
        { status: 400 },
      );
    }
    const client = userClient(WorldService);
    const [timeline, exposure] = await Promise.all([
      walkPages(
        async (pageSize, pageToken) => {
          const r = await client.getTimeline({ missionId: '', pageSize, pageToken });
          return { items: r.events, nextPageToken: r.nextPageToken };
        },
        { restartOnce: isInvalidArgument },
      ),
      client.getExposure({ findingId }),
    ]);
    const events = activityOfFinding(
      timeline.items.map((e) => ({ seq: Number(e.seq), kind: e.kind, summary: e.summary })),
      findingId,
    );
    return NextResponse.json({
      events,
      truncated: timeline.truncated,
      exposure: {
        found: exposure.found,
        verified: exposure.verified,
        totalSeconds: Number(exposure.totalSeconds),
        waitSeconds: Number(exposure.waitSeconds),
        agentSeconds: Number(exposure.agentSeconds),
      },
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
