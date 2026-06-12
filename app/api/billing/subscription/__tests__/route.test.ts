/**
 * @vitest-environment node
 *
 * Unit tests for the trialing-subscription route (card-first-signup S2,
 * dashboard#769).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateSub = vi.fn();
const mockGetTenant = vi.fn();

vi.mock('@/src/lib/billing/stripe', () => ({
  createTrialingSubscription: (...a: unknown[]) => mockCreateSub(...a),
  priceIdForTier: (tier: string) =>
    ({ team: 'price_team', org: 'price_org' } as Record<string, string>)[tier] ?? null,
}));
vi.mock('@/src/lib/k8s/tenants', () => ({
  getTenant: (...a: unknown[]) => mockGetTenant(...a),
}));
vi.mock('@/src/generated/plans', () => ({
  lookupPlan: (id: string) => ({ id, trialDays: id === 'team' ? 14 : 0 }),
}));
vi.mock('@/src/lib/pricing-display', () => ({
  selfServeTierIds: ['team', 'org'] as const,
  contactTierIds: ['enterprise-deploy'] as const,
}));
let allowed = true;
vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockImplementation(() => Promise.resolve({ allowed, resetIn: 60 })),
}));
vi.mock('@/src/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { POST } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/billing/subscription', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  allowed = true;
  mockCreateSub.mockReset().mockResolvedValue({ id: 'sub_1', status: 'trialing' });
  mockGetTenant.mockReset().mockResolvedValue({ status: { stripeCustomerId: 'cus_123' } });
});

describe('POST /api/billing/subscription', () => {
  it('creates a trialing subscription with the trial from the plan registry', async () => {
    const res = await POST(req({ tenantSlug: 'acme', tier: 'team', paymentMethodId: 'pm_1' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscriptionId: 'sub_1', status: 'trialing' });
    expect(mockCreateSub).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: 'team',
        priceId: 'price_team',
        customerId: 'cus_123',
        paymentMethodId: 'pm_1',
        trialPeriodDays: 14,
        tenantSlug: 'acme',
      }),
    );
  });

  it('reads the customer from STATUS, not the client', async () => {
    await POST(req({ tenantSlug: 'acme', tier: 'team', paymentMethodId: 'pm_1', customerId: 'cus_x' }));
    expect(mockCreateSub).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'cus_123' }));
  });

  it('400s on missing fields', async () => {
    const res = await POST(req({ tenantSlug: 'acme', tier: 'team' }));
    expect(res.status).toBe(400);
  });

  it('400s on a contact-sales tier', async () => {
    const res = await POST(req({ tenantSlug: 'acme', tier: 'enterprise-deploy', paymentMethodId: 'pm_1' }));
    expect(res.status).toBe(400);
  });

  it('503s when the plan has no positive trialDays', async () => {
    const res = await POST(req({ tenantSlug: 'acme', tier: 'org', paymentMethodId: 'pm_1' }));
    expect(res.status).toBe(503);
    expect(mockCreateSub).not.toHaveBeenCalled();
  });

  it('409s when the customer is not on status yet', async () => {
    mockGetTenant.mockResolvedValue({ status: {} });
    const res = await POST(req({ tenantSlug: 'acme', tier: 'team', paymentMethodId: 'pm_1' }));
    expect(res.status).toBe(409);
  });
});
