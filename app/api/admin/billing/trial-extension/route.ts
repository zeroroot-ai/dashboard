// API route handlers (route.ts under app/api/) are server-only by
// construction; 'use server' is for Server Actions modules. Under
// Next.js 16 / Turbopack, mixing the directive with a non-async export
// like `export const dynamic = 'force-dynamic'` fails the build.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  updateSubscriptionTrialEnd,
  findCustomerSubscription,
} from '@/src/lib/billing/stripe';
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';
import { getServerSession } from '@/src/lib/auth';
import { isCrossTenant } from '@/src/lib/auth/schema';
import { requireCsrf, CsrfError, csrfErrorResponse } from '@/src/lib/auth/csrf';
import { emitAuthAudit } from '@/src/lib/audit/auth';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/billing/trial-extension
 *
 * Grants a trial extension to a tenant. Platform-operator only.
 *
 * Auth: assertAuthorized for system_tenant admin relation.
 * Body: { tenantId: string, days: number }, days must be 1–30.
 *
 * On success: updates the Stripe subscription trial_end and emits a
 * billing.trial_extension audit event.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // CSRF, zero-trust-hardening Req 11.5 — this route mutates billing state.
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  // Auth gate: platform-operator ONLY.
  //
  // This previously called assertAuthorized() with a PluginAdminService
  // method as a stand-in for "system_tenant#admin". That method's registry
  // entry derives its object via `tenant_from_identity`, so it resolves to
  // admin on the CALLER'S OWN tenant — which every self-serve tenant owner
  // holds. The route accepts an arbitrary `tenantId` in the body, so that
  // gate authorized nothing about the tenant being modified.
  //
  // Cross-tenant authority is not expressible as a per-tenant relation, so
  // gate on the cross-tenant role directly (the same check
  // app/actions/crd/_authz.ts uses for tenant-lifecycle actions).
  const session = await getServerSession();
  if (!session) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }
  if (!isCrossTenant(session)) {
    return NextResponse.json({ error: 'permission denied' }, { status: 403 });
  }

  let body: { tenantId?: string; days?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { tenantId, days } = body;

  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  }

  if (!days || typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 30) {
    return NextResponse.json(
      { error: 'days must be an integer between 1 and 30' },
      { status: 400 },
    );
  }

  // Resolve the tenant's Stripe customer id from the operator-reported
  // provisioning snapshot (dashboard#813 — no Kubernetes read), then resolve
  // the live subscription from Stripe.
  //
  // KNOWN GAP (dashboard#1016, gibson#1339): this always 400s below. This is a
  // genuine cross-tenant read (a platform_operator acting on an arbitrary
  // tenantId) and gibson#1230's same-tenant gate on GetTenantProvisioningStatus
  // cannot be satisfied by ANY caller of this RPC (see gibson#1339 — the RPC is
  // `unauthenticated: true`-annotated, so ext-authz never resolves a tenant for
  // it at all, cross-tenant or same-tenant). Needs a new authenticated,
  // platform_operator-gated daemon RPC; do not attempt a header/client-swap fix
  // here, it cannot work against the current RPC.
  let customerId: string;
  try {
    const status = await getTenantProvisioningStatus(tenantId);
    if (!status.found) {
      return NextResponse.json({ error: 'tenant not found' }, { status: 400 });
    }
    customerId = status.stripeCustomerId;
  } catch (err) {
    logger.error(
      { tenantId, err: err instanceof Error ? err.message : String(err) },
      '[admin/billing/trial-extension] Failed to get tenant provisioning status',
    );
    return NextResponse.json({ error: 'tenant not found' }, { status: 400 });
  }

  if (!customerId) {
    return NextResponse.json(
      { error: 'tenant has no billing customer' },
      { status: 400 },
    );
  }

  let subscription: Awaited<ReturnType<typeof findCustomerSubscription>>;
  try {
    subscription = await findCustomerSubscription(customerId);
  } catch (err) {
    logger.error(
      { tenantId, customerId, err: err instanceof Error ? err.message : String(err) },
      '[admin/billing/trial-extension] Stripe subscription lookup failed',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }

  const subscriptionId = subscription?.id;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: 'tenant has no active subscription' },
      { status: 400 },
    );
  }

  // Calculate new trial end. Stripe's trial_end is a Unix timestamp (seconds).
  const currentTrialEnd = subscription?.trial_end
    ? new Date(subscription.trial_end * 1000)
    : new Date();
  const newTrialEnd = new Date(
    Math.max(currentTrialEnd.getTime(), Date.now()) + days * 86400_000,
  );
  const newTrialEndUnix = Math.floor(newTrialEnd.getTime() / 1000);

  // Idempotency key must NOT include a wall-clock bucket: a time-bucketed key
  // lets the same extension be re-applied once per bucket, stacking trial time
  // without bound. Key on the resulting trial end instead, so a repeat of the
  // same request is a genuine no-op at Stripe while a legitimately different
  // extension still gets its own key.
  const idempotencyKey = `admin:trial-extension:${tenantId}:${subscriptionId}:${newTrialEndUnix}`;

  try {
    await updateSubscriptionTrialEnd(subscriptionId, newTrialEndUnix, idempotencyKey);
  } catch (err) {
    logger.error(
      { tenantId, subscriptionId, err: err instanceof Error ? err.message : String(err) },
      '[admin/billing/trial-extension] Stripe API error',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }

  const newTrialEndIso = newTrialEnd.toISOString();

  emitAuthAudit({
    action: 'billing.trial_extension',
    outcome: 'ok',
    userId: 'operator', // platform operator; session user not available without parsing auth
    targetTenant: tenantId,
    reason: `extended_${days}_days`,
    // Additional fields available in the structured log object.
  });

  logger.info(
    {
      tenantId,
      subscriptionId,
      extensionDays: days,
      newTrialEnd: newTrialEndIso,
    },
    '[admin/billing/trial-extension] Trial extended',
  );

  return NextResponse.json({ ok: true, newTrialEnd: newTrialEndIso });
}
