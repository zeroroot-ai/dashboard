// @crd-authz-exempt-route: signup-public — the trialing subscription is
// created during pre-auth signup, immediately after the in-page Payment
// Element confirms the card. The Stripe customer is read server-side from
// the tenant CR status (tenant-operator#354), never from the client, and
// the payment method must already be attached to that customer by the
// SetupIntent confirmation. Idempotent per tenant.
//
// Card-first signup S2 (dashboard#769): completes the embedded flow that
// replaced the hosted-Checkout redirect.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  createTrialingSubscription,
  priceIdForTier,
  type BillingTier,
} from '@/src/lib/billing/stripe';
import { getTenant } from '@/src/lib/k8s/tenants';
import { lookupPlan, type PlanID } from '@/src/generated/plans';
import { selfServeTierIds, contactTierIds } from '@/src/lib/pricing-display';
import { checkRateLimit } from '@/src/lib/rate-limiter';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

const SUBSCRIPTION_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
  identifier: 'ip' as const,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 'billing/subscription', SUBSCRIPTION_RATE_LIMIT);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.resetIn) } },
    );
  }

  let body: { tenantSlug?: string; tier?: string; paymentMethodId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { tenantSlug, tier, paymentMethodId } = body;
  if (!tenantSlug || !tier || !paymentMethodId) {
    return NextResponse.json(
      { error: 'tenantSlug, tier and paymentMethodId are required' },
      { status: 400 },
    );
  }
  if ((contactTierIds as readonly string[]).includes(tier)) {
    return NextResponse.json({ error: 'contact sales for enterprise tiers' }, { status: 400 });
  }
  if (!(selfServeTierIds as readonly string[]).includes(tier)) {
    return NextResponse.json({ error: 'invalid tier' }, { status: 400 });
  }

  const priceId = priceIdForTier(tier);
  if (!priceId) {
    logger.error({ tier }, '[billing/subscription] missing price id for tier');
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }

  // Trial length comes from the canonical plan registry (S1) — never a
  // hardcoded constant.
  const trialPeriodDays = lookupPlan(tier as PlanID).trialDays;
  if (!trialPeriodDays || trialPeriodDays <= 0) {
    logger.error({ tier }, '[billing/subscription] plan has no positive trialDays');
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }

  let customerId: string | undefined;
  try {
    const tenant = await getTenant(tenantSlug);
    customerId = tenant.status?.stripeCustomerId;
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug },
      '[billing/subscription] failed to read tenant',
    );
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }
  if (!customerId) {
    return NextResponse.json({ error: 'customer not ready' }, { status: 409 });
  }

  try {
    const sub = await createTrialingSubscription({
      tier: tier as BillingTier,
      priceId,
      customerId,
      paymentMethodId,
      trialPeriodDays,
      tenantSlug,
      // One subscription per tenant — the bucket tolerates retries while
      // blocking double-submits.
      idempotencyKey: `tenant:${tenantSlug}:subscription:${Math.floor(Date.now() / 10000)}`,
    });
    return NextResponse.json({ subscriptionId: sub.id, status: sub.status });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tenantSlug, tier },
      '[billing/subscription] createTrialingSubscription failed',
    );
    return NextResponse.json({ error: 'billing temporarily unavailable' }, { status: 503 });
  }
}
