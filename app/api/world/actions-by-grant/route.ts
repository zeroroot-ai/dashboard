// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { toActionsByGrant } from '@/src/lib/actions/actions-by-grant';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/actions-by-grant
 *
 * The connector calls of the agents in the last 24 hours, grouped by the grant
 * that allowed each one and by the person who gave the grant
 * (WorldService.ListActionsByGrant, gibson#1499). The request sets no range, so
 * the daemon uses its default of 24 hours before now.
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
    const r = await userClient(WorldService).listActionsByGrant({});
    return NextResponse.json(toActionsByGrant(r));
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
