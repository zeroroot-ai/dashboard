// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { userClient } from '@/src/lib/gibson-client';
import { WorldService } from '@/src/gen/gibson/world/v1/world_pb';

/**
 * GET /api/world/scopes — the scope ids of the hosts in the tenant's World,
 * sorted and without duplicates (dashboard#192). The track record panel
 * offers them as the scopes a technique's record can be read in.
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
    const resp = await userClient(WorldService).listHosts({});
    const scopes = [...new Set(resp.hosts.map((h) => h.scopeId).filter(Boolean))].sort();
    return NextResponse.json({ scopes });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
