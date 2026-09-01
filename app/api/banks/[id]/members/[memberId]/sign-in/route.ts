/**
 * POST /api/banks/:id/members/:memberId/sign-in, ask a member at
 * NEEDS_SIGN_IN to run the Anthropic sign-in inside its sandbox
 * (BankService/StartSignIn). The daemon decides `owner`. gibson#1706 lane E2.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { startSignIn } from '@/src/lib/gibson-client/banks';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }
  const session = await getServerSession();
  if (!session) {
    return Response.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, { status: 401 });
  }
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const { id, memberId } = await params;
  try {
    const member = await startSignIn(id, memberId);
    return Response.json({ data: member });
  } catch (err) {
    return translateError(err, 'banks/[id]/members/[memberId]/sign-in');
  }
}
