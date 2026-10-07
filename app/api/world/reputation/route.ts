// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import type { TrackRecord } from '@/src/types/calibration';

/**
 * /api/world/reputation — the track record of one technique in one scope
 * (ADR-0122, ADR-0129 §3, gibson#619, dashboard#192).
 *
 * GET ?technique=T&scope=S returns WorldService.GetReputation: the prior
 *     strength a new hypothesis of the technique starts from in the scope,
 *     and whether any bet of it has settled there. Read-only; the daemon
 *     resolves the tenant server-side (WorldService over Envoy + ext-authz).
 */

/** The same bounds the request message validates. */
const MAX_TECHNIQUE = 4096;
const MAX_SCOPE = 1024;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const technique = req.nextUrl.searchParams.get('technique') ?? '';
    const scopeId = req.nextUrl.searchParams.get('scope') ?? '';
    if (!technique || technique.length > MAX_TECHNIQUE || scopeId.length > MAX_SCOPE) {
      return NextResponse.json(
        { error: { code: 'BAD_REQUEST', message: 'A technique and a valid scope are required' } },
        { status: 400 },
      );
    }

    const resp = await userClient(WorldService).getReputation({ technique, scopeId });
    const body: TrackRecord = {
      technique,
      scopeId,
      priorStrength: resp.prior,
      hasTrackRecord: resp.hasRecord,
    };
    return NextResponse.json(body);
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
