// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { userClient } from '@/src/lib/gibson-client/transport';
import { UserService, UserRefState } from '@/src/gen/gibson/tenant/v1/user_pb';
import type { UserRefView } from '@/src/lib/principals/label';

/** The daemon accepts at most this many ids per call. */
export const MAX_RESOLVE_IDS = 100;

/**
 * GET /api/users/resolve?ids=a,b,c
 *
 * Turns user ids into names for display, scoped to the caller's tenant
 * (UserService.ResolveUsers). A person who left the tenant comes back as
 * "removed" with no name, so the page shows "removed user" (hosted#205).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }
    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    const ids = parseIds(request.nextUrl.searchParams.get('ids'));
    if (ids.length > MAX_RESOLVE_IDS) {
      return NextResponse.json(
        { error: { code: 'INVALID_ARGUMENT', message: `At most ${MAX_RESOLVE_IDS} ids per request` } },
        { status: 400 },
      );
    }
    if (ids.length === 0) {
      return NextResponse.json({ data: [] as UserRefView[] });
    }

    const resp = await userClient(UserService).resolveUsers({ userIds: ids });
    const data: UserRefView[] = resp.users.map((u) => ({
      userId: u.userId,
      state: u.state === UserRefState.MEMBER ? 'member' : 'removed',
      displayName: u.displayName,
      email: u.email,
    }));
    return NextResponse.json({ data });
  } catch (error) {
    return daemonErrorResponse(error, { headers: request.headers });
  }
}

/** Distinct, non-empty ids from a comma-separated query value. */
export function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))];
}
