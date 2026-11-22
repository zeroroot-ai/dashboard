// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { toActionsByGrant } from '@/src/lib/actions/actions-by-grant';
import { walkPages } from '@/src/lib/gibson-client/paging';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/actions-by-grant
 *
 * The connector calls of the agents in the last 24 hours, grouped by the grant
 * that allowed each one and by the person who gave the grant
 * (WorldService.ListActionsByGrant, gibson#1499). The request sets no range, so
 * the daemon uses its default of 24 hours before now. The route reads every
 * page, up to the page bound of the walker. `truncated` is true when the daemon
 * cut the range or when the walk stopped before the last page.
 */
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }
    const client = userClient(WorldService);
    let daemonTruncated = false;
    const walk = await walkPages(async (pageSize, pageToken) => {
      const r = await client.listActionsByGrant({ pageSize, pageToken });
      daemonTruncated ||= r.truncated;
      return { items: r.groups, nextPageToken: r.nextPageToken };
    });
    return NextResponse.json(
      toActionsByGrant({ groups: walk.items, truncated: daemonTruncated || walk.truncated }),
    );
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
