/**
 * GET  /api/banks, the active tenant's banks (gibson.bank.v1.BankService/ListBanks)
 * POST /api/banks, declare a bank (BankService/CreateBank)
 *
 * The tenant is the authenticated identity's active tenant, resolved
 * server-side; it is never a query parameter. Every call flows through
 * `userClient` -> Envoy + ext-authz -> daemon. gibson#1706 lane E1.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { translateError } from '@/src/lib/providers-route-error';
import { createBank, listBanks } from '@/src/lib/gibson-client/banks';
import { createBankSchema } from '@/src/lib/banks/schema';
import type { LoginShapeName, SpillPolicyName } from '@/src/lib/banks/view';

const ROUTE = 'banks';

function unauthenticated(): Response {
  return Response.json(
    { error: { code: 'unauthenticated', message: 'Authentication required' } },
    { status: 401 },
  );
}

export async function GET(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return unauthenticated();
  try {
    await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }
  try {
    const page = await listBanks(req.nextUrl.searchParams.get('pageToken') ?? '');
    return Response.json({ data: page.banks, nextPageToken: page.nextPageToken });
  } catch (err) {
    return translateError(err, ROUTE);
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
  const parsed = createBankSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'invalid_request', message: parsed.error.issues[0]?.message ?? 'Invalid request', issues: parsed.error.issues } },
      { status: 400 },
    );
  }
  const v = parsed.data;
  try {
    const bank = await createBank({
      name: v.name,
      tenantOwned: v.tenantOwned,
      desiredCount: v.desiredCount,
      loginShape: v.loginShape as LoginShapeName,
      providerConfigName: v.providerConfigName,
      agentName: v.agentName,
      model: v.model,
      maxJobsInFlight: v.maxJobsInFlight,
      staleLimitSeconds: v.staleLimitMinutes * 60,
      spillPolicy: v.spillPolicy as SpillPolicyName,
    });
    return Response.json({ data: bank }, { status: 201 });
  } catch (err) {
    return translateError(err, ROUTE);
  }
}
