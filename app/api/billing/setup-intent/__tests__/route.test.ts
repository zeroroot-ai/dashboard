/**
 * @vitest-environment node
 *
 * Unit tests for the SetupIntent route (card-first-signup S2, dashboard#769).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockCreateSetupIntent = vi.fn();
const mockGetTenant = vi.fn();

vi.mock('@/src/lib/billing/stripe', () => ({
  createSetupIntent: (...a: unknown[]) => mockCreateSetupIntent(...a),
}));
vi.mock('@/src/lib/k8s/tenants', () => ({
  getTenant: (...a: unknown[]) => mockGetTenant(...a),
}));
let allowed = true;
vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockImplementation(() => Promise.resolve({ allowed, resetIn: 60 })),
}));
vi.mock('@/src/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn() } }));

import { POST } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/billing/setup-intent', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  allowed = true;
  mockCreateSetupIntent.mockReset().mockResolvedValue({ id: 'seti_1', client_secret: 'cs_secret' });
  mockGetTenant.mockReset().mockResolvedValue({ status: { stripeCustomerId: 'cus_123' } });
});

describe('POST /api/billing/setup-intent', () => {
  it('returns the client secret for a ready tenant', async () => {
    const res = await POST(req({ tenantSlug: 'acme' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ clientSecret: 'cs_secret' });
    expect(mockCreateSetupIntent).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_123', tenantSlug: 'acme' }),
    );
  });

  it('reads the customer from tenant STATUS, never the client body', async () => {
    await POST(req({ tenantSlug: 'acme', customerId: 'cus_attacker' }));
    expect(mockCreateSetupIntent).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_123' }),
    );
  });

  it('409s when the saga has not written the customer yet', async () => {
    mockGetTenant.mockResolvedValue({ status: {} });
    const res = await POST(req({ tenantSlug: 'acme' }));
    expect(res.status).toBe(409);
    expect(mockCreateSetupIntent).not.toHaveBeenCalled();
  });

  it('400s without tenantSlug', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
  });

  it('429s when rate limited', async () => {
    allowed = false;
    const res = await POST(req({ tenantSlug: 'acme' }));
    expect(res.status).toBe(429);
  });
});
