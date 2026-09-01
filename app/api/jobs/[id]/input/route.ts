/**
 * POST /api/jobs/:id/input, send the next turn or the answer to a waiting
 * job (JobService/SendInput). A client never sends wrap_up. gibson#1706 lane E3.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { sendInput } from '@/src/lib/gibson-client/jobs';
import { sendInputSchema } from '@/src/lib/jobs/schema';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  const parsed = sendInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' } },
      { status: 400 },
    );
  }
  try {
    const input = await sendInput(id, parsed.data.message, parsed.data.kind);
    return Response.json({ data: input }, { status: 201 });
  } catch (err) {
    return translateError(err, 'jobs/[id]/input');
  }
}
