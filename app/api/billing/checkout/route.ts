// @crd-authz-exempt-route: checkout-public, the pricing page CTAs are public.
// Session data (customer email, existing customer ID) is opportunistically
// extracted from the request body but is NOT required. The tenant slug comes
// from the request body and is used as client_reference_id for the webhook
// to reconcile. The Stripe session URL is returned to the client for redirect.
//
// NOTE: API route handlers (route.ts under app/api/) are server-only by
// construction; the 'use server' directive is for Server Actions modules,
// not route handlers. Under Next.js 16 / Turbopack, mixing the directive
// with a non-async export like `export const dynamic = 'force-dynamic'`
// fails the build with "Only async functions are allowed to be exported
// in a 'use server' file."

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import {
  createCheckoutSession,
  priceIdForTier,
  type BillingTier,
} from '@/src/lib/billing/stripe';
import { selfServeTierIds, contactTierIds } from '@/src/lib/pricing-display';
import { checkRateLimit } from '@/src/lib/rate-limiter';
import { logger } from '@/src/lib/logger';

export const dynamic = 'force-dynamic';

// Rate limit: 10 requests per minute per IP.
const CHECKOUT_RATE_LIMIT = {
  maxRequests: 10,
  windowSeconds: 60,
  identifier: 'ip' as const,
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Apply rate limit before any processing.
  const rateLimitResult = await checkRateLimit(
    req,
    'billing/checkout',
    CHECKOUT_RATE_LIMIT,
  );
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: 'rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': String(rateLimitResult.resetIn),
        },
      },
    );
  }

  let body: {
    tier?: string;
    tenantSlug?: string;
    customerEmail?: string;
    existingCustomerId?: string;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid request body' }, { status: 400 });
  }

  const { tier, tenantSlug, customerEmail, existingCustomerId } = body;

  if (!tier) {
    return NextResponse.json({ error: 'tier is required' }, { status: 400 });
  }

  // Validate tier: contact-sales tiers are rejected with a helpful message.
  if ((contactTierIds as readonly string[]).includes(tier)) {
    return NextResponse.json(
      {
        error: 'contact sales for enterprise tiers',
        salesUrl: '/contact-sales',
      },
      { status: 400 },
    );
  }

  // Validate tier: must be in selfServeTierIds (i.e., a self-serve paid tier).
  if (!(selfServeTierIds as readonly string[]).includes(tier)) {
    return NextResponse.json({ error: 'invalid tier' }, { status: 400 });
  }

  // Resolve price ID for the tier.
  const priceId = priceIdForTier(tier);
  if (!priceId) {
    logger.error(
      { tier },
      '[billing/checkout] Missing price ID env var for tier',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }

  // Deterministic idempotency key: 10-second bucket prevents duplicate sessions
  // from rapid double-submits while allowing retries after the window passes.
  const tenantKey = tenantSlug ?? 'anon';
  const idempotencyKey = `tenant:${tenantKey}:checkout:${tier}:${Math.floor(Date.now() / 10000)}`;

  try {
    const session = await createCheckoutSession({
      tier: tier as BillingTier,
      priceId,
      tenantSlug: tenantKey,
      idempotencyKey,
      ...(existingCustomerId ? { customerId: existingCustomerId } : {}),
      ...(customerEmail && !existingCustomerId ? { customerEmail } : {}),
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), tier },
      '[billing/checkout] Stripe API error creating checkout session',
    );
    return NextResponse.json(
      { error: 'billing temporarily unavailable' },
      { status: 503 },
    );
  }
}
