/**
 * GET    /api/banks/:id, one bank (BankService/GetBank)
 * PATCH  /api/banks/:id, change count and policies (BankService/UpdateBank)
 * DELETE /api/banks/:id, remove the bank (BankService/DeleteBank)
 *
 * The daemon decides `can_read` and `owner` on the named bank; a bank the
 * caller may not read is NOT_FOUND. gibson#1706 lane E1.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { deleteBank, getBank, updateBank } from '@/src/lib/gibson-client/banks';
import { updateBankSchema } from '@/src/lib/banks/schema';
import type { SpillPolicyName } from '@/src/lib/banks/view';

const ROUTE = 'banks/[id]';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function unauthenticated(): Response {
  return Response.json(
    { error: { code: 'unauthenticated', message: 'Authentication required' } },
    { status: 401 },
  );
}

function notFound(): Response {
  return Response.json({ error: { code: 'not_found', message: 'Bank not found' } }, { status: 404 });
}

async function guard(req: NextRequest, mutating: boolean): Promise<Response | null> {
  if (mutating) {
    try {
      await requireCsrf(req);
    } catch (err) {
      if (err instanceof CsrfError) return csrfErrorResponse(err);
      throw err;
    }
  }
  const session = await getServerSession();
  if (!session) return unauthenticated();
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  return null;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const denied = await guard(req, false);
  if (denied) return denied;
  const { id } = await params;
  try {
    const bank = await getBank(id);
    if (!bank) return notFound();
    return Response.json({ data: bank });
  } catch (err) {
    return translateError(err, ROUTE);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const denied = await guard(req, true);
  if (denied) return denied;
  const { id } = await params;
  const body: unknown = await req.json().catch(() => null);
  const parsed = updateBankSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request', issues: parsed.error.issues } },
      { status: 400 },
    );
  }
  const v = parsed.data;
  try {
    const bank = await updateBank(id, {
      desiredCount: v.desiredCount,
      maxJobsInFlight: v.maxJobsInFlight,
      staleLimitSeconds: v.staleLimitMinutes === undefined ? undefined : v.staleLimitMinutes * 60,
      spillPolicy: v.spillPolicy as SpillPolicyName | undefined,
    });
    if (!bank) return notFound();
    return Response.json({ data: bank });
  } catch (err) {
    return translateError(err, ROUTE);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const denied = await guard(req, true);
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteBank(id);
    return new Response(null, { status: 204 });
  } catch (err) {
    return translateError(err, ROUTE);
  }
}
