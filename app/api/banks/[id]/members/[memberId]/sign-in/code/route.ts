/**
 * POST /api/banks/:id/members/:memberId/sign-in/code, pass the code the
 * person got from Anthropic to the flow inside the sandbox
 * (BankService/SubmitSignInCode). The code is never logged. gibson#1706 lane E2.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { submitSignInCode } from '@/src/lib/gibson-client/banks';

const bodySchema = z.object({ code: z.string().trim().min(1, 'Paste the code').max(512) });

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
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' } }, { status: 400 });
  }
  try {
    const member = await submitSignInCode(id, memberId, parsed.data.code);
    return Response.json({ data: member });
  } catch (err) {
    return translateError(err, 'banks/[id]/members/[memberId]/sign-in/code');
  }
}
