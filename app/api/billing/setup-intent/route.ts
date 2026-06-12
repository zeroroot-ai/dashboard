// @crd-authz-exempt-route: signup-public — card collection happens during
// the pre-auth signup flow. The customer ID is NOT taken from the client;
// it is read server-side from the tenant CR's status (the saga-created
// Stripe customer, tenant-operator#354), so a caller cannot mint a
// SetupIntent against an arbitrary customer.
//
// Card-first signup S2 (dashboard#769): issues the SetupIntent client
// secret that drives the in-page Payment Element.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { createSetupIntent } from '@/src/lib/billing/stripe';
import { getTenant } from '@/src/lib/k8s/tenants';
import { checkRateLimit } from '@/src/lib/rate-limiter';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

const SETUP_INTENT_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
  identifier: 'ip' as const,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 'billing/setup-intent', SETUP_INTENT_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.resetIn) } },
    );
  }

  let body: { tenantSlug?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const tenantSlug = body.tenantSlug;
  if (!tenantSlug) {
    return NextResponse.json({ error: 'tenantSlug is required' }, { status: 400 });
  }

  let customerId: string | undefined;
  try {
    const tenant = await getTenant(tenantSlug);
    customerId = tenant.status?.stripeCustomerId;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/setup-intent] failed to read tenant',
    );
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }

  if (!customerId) {
    // The CreateStripeCustomer saga step has not yet written the customer
    // to status. The panel retries until it appears.
    return NextResponse.json({ error: 'customer not ready' }, { status: 409 });
  }

  try {
    const intent = await createSetupIntent({
      customerId,
      tenantSlug,
      idempotencyKey: `tenant:${tenantSlug}:setup-intent:${Math.floor(Date.now() / 10000)}`,
    });
    return NextResponse.json({ clientSecret: intent.client_secret });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/setup-intent] createSetupIntent failed',
    );
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }
}
