/**
 * GET  /api/jobs, jobs of the active tenant, filtered by bank, member or state (JobService/ListJobs)
 * POST /api/jobs, open a job with a goal-only spec (JobService/OpenJob)
 *
 * gibson#1706 lane E3. Every call flows through Envoy + ext-authz.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { listJobs, openJob } from '@/src/lib/gibson-client/jobs';
import { openJobSchema } from '@/src/lib/jobs/schema';
import type { JobStateName } from '@/src/lib/jobs/view';

const STATES = new Set<JobStateName>(['open', 'working', 'waiting', 'closed']);

function unauthenticated(): Response {
  return Response.json({ error: { code: 'unauthenticated', message: 'Authentication required' } }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthenticated();
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const q = req.nextUrl.searchParams;
  const rawState = q.get('state') ?? '';
  const state = STATES.has(rawState as JobStateName) ? (rawState as JobStateName) : undefined;
  try {
    const page = await listJobs({
      bankId: q.get('bankId') ?? '',
      memberId: q.get('memberId') ?? '',
      state,
      pageToken: q.get('pageToken') ?? '',
    });
    return Response.json({ data: page.jobs, nextPageToken: page.nextPageToken });
  } catch (err) {
    return translateError(err, 'jobs');
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }
  const session = await getServerSession();
  if (!session) return unauthenticated();
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  const body: unknown = await req.json().catch(() => null);
  const parsed = openJobSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request' } },
      { status: 400 },
    );
  }
  try {
    const job = await openJob(parsed.data.bankId, parsed.data.memberId, parsed.data.goal);
    return Response.json({ data: job }, { status: 201 });
  } catch (err) {
    return translateError(err, 'jobs');
  }
}
