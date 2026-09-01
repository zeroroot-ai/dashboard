/**
 * GET /api/banks/:id/members, the members of one bank with the status each
 * last reported (BankService/ListMembers). The daemon decides `can_read`.
 * gibson#1706 lane E1.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { translateError } from '@/src/lib/providers-route-error';
import { listMembers } from '@/src/lib/gibson-client/banks';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const { id } = await params;
  try {
    const page = await listMembers(id, req.nextUrl.searchParams.get('pageToken') ?? '');
    return Response.json({ data: page.members, nextPageToken: page.nextPageToken });
  } catch (err) {
    return translateError(err, 'banks/[id]/members');
  }
}
