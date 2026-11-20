// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { toOpenFinding } from '@/src/lib/findings/open-findings';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/open-findings[?limit=N&cursor=TOKEN]
 *
 * The findings that are not verified, in the rank order of the daemon
 * (WorldService.ListOpenFindings, gibson#1498). The route sorts nothing.
 * The daemon resolves the tenant from the identity of the caller.
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
    const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10) || 0, 0), 1000);
    const pageToken = req.nextUrl.searchParams.get('cursor') ?? '';
    const r = await userClient(WorldService).listOpenFindings({ pageSize: limit, pageToken });
    return NextResponse.json({
      findings: r.findings.map(toOpenFinding),
      nextCursor: r.nextPageToken || undefined,
    });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
