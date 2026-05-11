// API route handlers (route.ts under app/api/) are server-only by
// construction; 'use server' is for Server Actions modules. Under
// Next.js 16 / Turbopack, mixing the directive with a non-async export
// like `export const dynamic = 'force-dynamic'` fails the build.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { updateSubscriptionTrialEnd } from '@/src/lib/billing/stripe';
import { getTenant } from '@/src/lib/k8s/tenants';
import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';
import { emitAuthAudit } from '@/src/lib/audit/auth';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/billing/trial-extension
 *
 * Grants a trial extension to a tenant. Platform-operator only.
 *
 * Auth: assertAuthorized for system_tenant admin relation.
 * Body: { tenantId: string, days: number } — days must be 1–30.
 *
 * On success: updates the Stripe subscription trial_end and emits a
 * billing.trial_extension audit event.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth gate: platform-operator only.
  // Uses PluginsAdminService as the system_tenant#admin relation gate
  // (same pattern as existing admin routes).
  try {
    await assertAuthorized('/gibson.admin.v1.PluginsAdminService/RegisterPlugin');
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return NextResponse.json({ error: 'permission denied' }, { status: 403 });
    }
    throw err;
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

  // Fetch tenant to get subscription ID.
  let tenant: Awaited<ReturnType<typeof getTenant>>;
  try {
    tenant = await getTenant(tenantId);
  } catch (err) {
    logger.error(
      { tenantId, err: err instanceof Error ? err.message : String(err) },
      '[admin/billing/trial-extension] Failed to get Tenant CR',
    );
    return NextResponse.json({ error: 'tenant not found' }, { status: 400 });
  }

  const subscriptionId = tenant.status?.billing?.subscriptionId;
  if (!subscriptionId) {
    return NextResponse.json(
      { error: 'tenant has no active subscription' },
      { status: 400 },
    );
  }

  // Calculate new trial end.
  const currentTrialEnd = tenant.status?.billing?.trialEnd
    ? new Date(tenant.status.billing.trialEnd)
    : new Date();
  const newTrialEnd = new Date(
    Math.max(currentTrialEnd.getTime(), Date.now()) + days * 86400_000,
  );
  const newTrialEndUnix = Math.floor(newTrialEnd.getTime() / 1000);

  const idempotencyKey = `admin:trial-extension:${tenantId}:${subscriptionId}:${Math.floor(Date.now() / 10000)}`;

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
