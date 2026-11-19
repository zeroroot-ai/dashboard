// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';
import { adaptCallDetail } from '@/src/lib/world-traces';

/**
 * GET /api/world/llm-call?callId=ID
 *
 * The model call fetch of the per-tick inspector (epic ecs-brain, gibson#1059).
 * Returns the full record of one model call: the metadata, the request items
 * and the output items. It calls the daemon's GetLlmCall (gibson#755). The
 * daemon scopes the call to the tenant of the caller. The dashboard never
 * touches the brain directly. callId is required. An unknown call returns 404.
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

    const callId = req.nextUrl.searchParams.get('callId') ?? '';
    if (!callId) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: 'callId is required' } },
        { status: 400 },
      );
    }

    const client = userClient(WorldService);
    const res = await client.getLlmCall({ callId });
    const call = res.call;
    if (!call) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'LLM call not found' } },
        { status: 404 },
      );
    }

    return NextResponse.json(adaptCallDetail(call));
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
