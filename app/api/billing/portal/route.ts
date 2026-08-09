// API route handlers (route.ts under app/api/) are server-only by
// construction; 'use server' is for Server Actions modules. Under
// Next.js 16 / Turbopack, mixing the directive with a non-async export
// like `export const dynamic = 'force-dynamic'` fails the build.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { billingEnabled } from '@/src/lib/billing/billing-enabled';
import { createPortalSession } from '@/src/lib/billing/stripe';
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';
import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';
import { readRawActiveTenant } from '@/src/lib/auth/active-tenant';
import { checkRateLimit } from '@/src/lib/rate-limiter';
import { logger } from '@/src/lib/logger';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';

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
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  // Billing master switch (dashboard#809 / ADR-0050). On-prem / self-host has
  // no Stripe-backed billing backend; the "Manage payment" surface is hidden
  // in the UI and the route no-ops here as defense-in-depth (404). Fail-closed:
  // absent flag ⇒ billing off.
  if (!billingEnabled()) {
    return NextResponse.json({ error: 'billing not enabled' }, { status: 404 });
  }

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
    await assertAuthorized('/gibson.tenant.v1.SecretsService/CountSecrets');
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

  // Look up the operator-reported provisioning status to get the Stripe
  // customer ID (dashboard#813 — no Kubernetes read).
  //
  // KNOWN GAP (dashboard#1016, gibson#1339): this always 400s below. gibson#1230
  // added a same-tenant gate to GetTenantProvisioningStatus that this route
  // cannot satisfy — the RPC is proto-annotated `unauthenticated: true`, so
  // ext-authz skips tenant resolution entirely for it (never reads
  // x-gibson-tenant into the identity forwarded to the daemon), regardless of
  // whether this call goes through userClient or serviceClient or what tenant
  // value is passed in. stripe_customer_id is redacted for every caller,
  // including the tenant reading its own status. Root-caused in gibson#1339,
  // which proposes a new rule-mode RPC scoped to the caller's own tenant. Do
  // not attempt to fix this by threading tenantSlug into a serviceClient call
  // here — verified ineffective, see gibson#1339's trace.
  let customerId: string;
  try {
    const status = await getTenantProvisioningStatus(tenantSlug);
    customerId = status.stripeCustomerId;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/portal] Failed to get tenant provisioning status',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }

  if (!customerId) {
    return NextResponse.json(
      { error: 'no billing customer' },
      { status: 400 },
    );
  }

  // PUBLIC_URL is REQUIRED at boot (src/lib/env-validator.ts), instrumentation
  // crashes the pod before this handler can run if it's missing.
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    return NextResponse.json(
      { error: 'PUBLIC_URL not configured (see env-validator)' },
      { status: 500 },
    );
  }
  const idempotencyKey = `tenant:${tenantSlug}:portal:${Math.floor(Date.now() / 10000)}`;

  try {
    const session = await createPortalSession({
      customerId,
      returnUrl: `${publicUrl}/dashboard/pages/settings/billing`,
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
