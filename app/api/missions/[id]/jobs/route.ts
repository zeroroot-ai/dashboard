// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
import { collectAllPages } from '@/src/lib/pagination';
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
    // Walked through collectAllPages() (dashboard#107 follow-up): the
    // previous hand-rolled `do { ... } while (pageToken !== '')` never
    // stopped if ListJobs returned the same token again or an empty page
    // with a token still set, turning one RPC into an unbounded accumulation
    // of jobs in memory. Collect every RAW job first (unfiltered, so an
    // empty page of jobs that all belong to OTHER runs never looks like "no
    // more data" to the guard), then filter to this run.
    const allJobs = await collectAllPages(
      async (pageToken) => {
        const page = await listJobs({ pageToken });
        return { items: page.jobs, nextPageToken: page.nextPageToken };
      },
      { rpc: 'JobService.ListJobs', context: { missionId: id } },
    );
    const data: JobView[] = allJobs.filter((job) => job.spec.context[RUN_CONTEXT_KEY] === id);
    return Response.json({ data });
  } catch (err) {
    return translateError(err, 'missions/[id]/jobs');
  }
}
