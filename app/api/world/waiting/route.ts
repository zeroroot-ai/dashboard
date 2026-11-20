// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import type { WaitingItemDto } from '@/src/lib/waits/wait-items';

/**
 * GET /api/world/waiting
 *
 * Each item that waits on a person, with the wait so far
 * (WorldService.ListWaitingOnPerson, gibson#1500): a destructive action, a
 * refused merge, a wait on the next scan, and a missing health signal.
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
    const r = await userClient(WorldService).listWaitingOnPerson({});
    const items: WaitingItemDto[] = r.items.map((i) => ({
      kind: i.kind,
      id: i.id,
      since: i.since ? new Date(Number(i.since.seconds) * 1000).toISOString() : '',
      waitedSeconds: Number(i.waitedSeconds),
    }));
    return NextResponse.json({ items });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
