/** GET /api/jobs/:id, one job (JobService/GetJob). gibson#1706 lane E3. */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { translateError } from '@/src/lib/providers-route-error';
import { getJob } from '@/src/lib/gibson-client/jobs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  try {
    const job = await getJob(id);
    if (!job) return Response.json({ error: { code: 'not_found', message: 'Job not found' } }, { status: 404 });
    return Response.json({ data: job });
  } catch (err) {
    return translateError(err, 'jobs/[id]');
  }
}
