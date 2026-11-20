// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import {
  EXPOSURE_PERIOD_SECONDS,
  toExposureTrend,
  toRevertRate,
} from '@/src/lib/exposure/exposure';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/exposure
 *
 * The median exposure window of the findings verified in the last week, with
 * its split into agent time and wait time and the median of the week before
 * (WorldService.GetExposureTrend, gibson#1467), and the share of merged fixes
 * that an agent reverted (WorldService.GetRevertRate, gibson#1468). The daemon
 * computes each number. The route computes none.
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
    const periodSeconds = BigInt(EXPOSURE_PERIOD_SECONDS);
    const [trend, revert] = await Promise.all([
      client.getExposureTrend({ periodSeconds }),
      client.getRevertRate({ periodSeconds }),
    ]);
    return NextResponse.json({ exposure: toExposureTrend(trend), revert: toRevertRate(revert) });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
