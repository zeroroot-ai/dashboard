'use server';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createPortalSession } from '@/src/lib/billing/stripe';
import { getTenant } from '@/src/lib/k8s/tenants';
import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';
import { readRawActiveTenant } from '@/src/lib/auth/active-tenant';
import { checkRateLimit } from '@/src/lib/rate-limiter';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Rate limit: 20 requests per minute per IP.
const PORTAL_RATE_LIMIT = {
  maxRequests: 20,
  windowSeconds: 60,
  identifier: 'ip' as const,
};

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for an authenticated tenant admin.
 * Returns { url } for client-side redirect to the Stripe-hosted portal.
 *
 * Auth: assertAuthorized for TenantAdminService (tenant_admin relation).
 * Rate limit: 20 req/min/IP.
 * Idempotency: 10-second bucket key prevents duplicate sessions from double-submits.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Apply rate limit first.
  const rateLimitResult = await checkRateLimit(
    req,
    'billing/portal',
    PORTAL_RATE_LIMIT,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimitResult.resetIn) },
      },
    );
  }

  // Auth gate: tenant_admin only.
  try {
    await assertAuthorized('/gibson.admin.v1.TenantAdminService/CountSecrets');
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return NextResponse.json({ error: 'permission denied' }, { status: 403 });
    }
    throw err;
  }

  // Resolve the active tenant slug from the session cookie.
  const activeTenant = await readRawActiveTenant();
  // readRawActiveTenant returns { status, tenantId? } where tenantId is the slug.
  const tenantSlug = activeTenant?.tenantId;

  if (!tenantSlug) {
    return NextResponse.json(
      { error: 'no active tenant' },
      { status: 400 },
    );
  }

  // Look up the Tenant CR to get the Stripe customer ID.
  let tenant: Awaited<ReturnType<typeof getTenant>> | null = null;
  try {
    tenant = await getTenant(tenantSlug);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/portal] Failed to get Tenant CR',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }

  const customerId = tenant.spec.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json(
      { error: 'no billing customer' },
      { status: 400 },
    );
  }

  const publicUrl = process.env.PUBLIC_URL ?? 'http://localhost:3000';
  const idempotencyKey = `tenant:${tenantSlug}:portal:${Math.floor(Date.now() / 10000)}`;

  try {
    const session = await createPortalSession({
      customerId,
      returnUrl: `${publicUrl}/dashboard/settings/billing`,
      idempotencyKey,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/portal] Stripe API error creating portal session',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }
}
