/**
 * @vitest-environment node
 *
 * Unit tests for the trial-extension admin route at
 * app/api/admin/billing/trial-extension/route.ts.
 *
 * Post dashboard#855 the route resolves the tenant's Stripe customer id from
 * the daemon's operator-reported provisioning snapshot
 * (getTenantProvisioningStatus) — NOT the Tenant CR — then resolves the live
 * subscription from Stripe via findCustomerSubscription (the daemon status RPC
 * does not carry the subscription id or trial_end, so those come from Stripe).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockUpdateSubscriptionTrialEnd = vi.fn();
const mockFindCustomerSubscription = vi.fn();
vi.mock('@/src/lib/billing/stripe', () => ({
  updateSubscriptionTrialEnd: (...args: unknown[]) => mockUpdateSubscriptionTrialEnd(...args),
  findCustomerSubscription: (...args: unknown[]) => mockFindCustomerSubscription(...args),
}));

const mockGetProvisioningStatus = vi.fn();
vi.mock('@/src/lib/gibson-client/provisioning', () => ({
  getTenantProvisioningStatus: (...args: unknown[]) => mockGetProvisioningStatus(...args),
}));

let mockAssertAuthorizedShouldThrow: Error | null = null;
vi.mock('@/src/lib/auth/assert-authorized', () => ({
  assertAuthorized: vi.fn().mockImplementation(() => {
    if (mockAssertAuthorizedShouldThrow) throw mockAssertAuthorizedShouldThrow;
    return Promise.resolve();
  }),
  AuthzDeniedError: class AuthzDeniedError extends Error {
    constructor(method: string, reason: string) {
      super(`assertAuthorized: ${reason} for ${method}`);
      this.name = 'AuthzDeniedError';
    }
  },
}));

vi.mock('@/src/lib/audit/auth', () => ({
  emitAuthAudit: vi.fn(),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------

import { POST } from '../route';
import { AuthzDeniedError } from '@/src/lib/auth/assert-authorized';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/admin/billing/trial-extension', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/billing/trial-extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssertAuthorizedShouldThrow = null;
    mockGetProvisioningStatus.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_test123',
    });
    mockFindCustomerSubscription.mockResolvedValue({
      id: 'sub_test123',
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000),
    });
    mockUpdateSubscriptionTrialEnd.mockResolvedValue(undefined);
  });

  it('returns 403 when assertAuthorized throws AuthzDeniedError', async () => {
    mockAssertAuthorizedShouldThrow = new AuthzDeniedError(
      '/gibson.pluginadmin.v1.PluginAdminService/RegisterPlugin',
      'relation-not-met',
    );
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(403);
  });

  it('rejects days outside 1–30', async () => {
    const res = await POST(makeRequest({ tenantId: 'acme', days: 99 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when the provisioning snapshot has no record (found: false)', async () => {
    mockGetProvisioningStatus.mockResolvedValue({ found: false, stripeCustomerId: '' });
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('tenant not found');
  });

  it('returns 400 when the tenant has no Stripe customer', async () => {
    mockGetProvisioningStatus.mockResolvedValue({ found: true, stripeCustomerId: '' });
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('tenant has no billing customer');
  });

  it('returns 400 when the customer has no subscription', async () => {
    mockFindCustomerSubscription.mockResolvedValue(null);
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('tenant has no active subscription');
  });

  it('resolves the customer id from the snapshot and the subscription from Stripe, then extends', async () => {
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(200);
    expect(mockGetProvisioningStatus).toHaveBeenCalledWith('acme');
    expect(mockFindCustomerSubscription).toHaveBeenCalledWith('cus_test123');
    expect(mockUpdateSubscriptionTrialEnd).toHaveBeenCalledOnce();
    const [subId, newTrialEndUnix] = mockUpdateSubscriptionTrialEnd.mock.calls[0] as [
      string,
      number,
    ];
    expect(subId).toBe('sub_test123');
    // New trial end is at least `days` in the future.
    expect(newTrialEndUnix).toBeGreaterThan(Math.floor(Date.now() / 1000) + 6 * 86400);
  });

  it('returns 503 when the Stripe subscription lookup fails', async () => {
    mockFindCustomerSubscription.mockRejectedValue(new Error('stripe down'));
    const res = await POST(makeRequest({ tenantId: 'acme', days: 7 }));
    expect(res.status).toBe(503);
  });
});
