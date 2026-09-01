/**
 * GET /api/missions/:id/jobs, the jobs a mission run's job nodes opened
 * (gibson#1706 lane E5).
 *
 * `ListJobs` has no run filter (sdk v0.177.0), so the route keeps the jobs
 * whose spec context names this run in `mission_run_id`, which the job node
 * executor stamps when it opens the job (gibson#1713). The tenant scope is
 * the daemon's; the route filters by run only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { translateError } from '@/src/lib/providers-route-error';
import { listJobs } from '@/src/lib/gibson-client/jobs';
import type { JobView } from '@/src/lib/jobs/view';

export const RUN_CONTEXT_KEY = 'mission_run_id';

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
    const data: JobView[] = [];
    let pageToken = '';
    do {
      const page = await listJobs({ pageToken });
      for (const job of page.jobs) if (job.spec.context[RUN_CONTEXT_KEY] === id) data.push(job);
      pageToken = page.nextPageToken;
    } while (pageToken !== '');
    return Response.json({ data });
  } catch (err) {
    return translateError(err, 'missions/[id]/jobs');
  }
}
