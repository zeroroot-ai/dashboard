/**
 * @vitest-environment node
 *
 * Tests for the public workspace-name availability endpoint.
 *
 * This route is unauthenticated and answers a question about other tenants'
 * existence, so it is a name-enumeration oracle by construction. It cannot be
 * closed (the signup form needs the answer), so the controls are: a rate limit
 * that bounds bulk enumeration, and a response-time floor so the "taken" and
 * "available" branches are not separable by latency. Both are asserted here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetStatus = vi.fn();
vi.mock('@/src/lib/gibson-client/provisioning', () => ({
  getTenantProvisioningStatus: (slug: string) => mockGetStatus(slug),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from '../route';
import { clearRateLimitStore, initializeRateLimiter } from '@/src/lib/rate-limiter';

function makeRequest(name: string, ip = '203.0.113.7'): NextRequest {
  return new NextRequest(
    `http://localhost/api/auth/tenant-available?name=${encodeURIComponent(name)}`,
    { headers: { 'x-forwarded-for': ip } },
  );
}

describe('GET /api/auth/tenant-available', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeRateLimiter(null);
    clearRateLimitStore();
    mockGetStatus.mockResolvedValue({ found: false });
  });

  afterEach(() => {
    clearRateLimitStore();
  });

  it('reports an unused name as available', async () => {
    const res = await GET(makeRequest('brand-new-workspace'));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ available: true });
  });

  it('reports an existing name as taken', async () => {
    mockGetStatus.mockResolvedValue({ found: true });
    const res = await GET(makeRequest('acme'));
    await expect(res.json()).resolves.toMatchObject({ available: false });
  });

  it('rate limits bulk enumeration from one source', async () => {
    // The configured budget is 30/min. Burn it, then expect a 429.
    for (let i = 0; i < 30; i += 1) {
      const ok = await GET(makeRequest(`name-${i}`));
      expect(ok.status).toBe(200);
    }
    const limited = await GET(makeRequest('name-31'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
  }, 30_000);

  it('does not let one source exhaust another source\'s budget', async () => {
    for (let i = 0; i < 30; i += 1) {
      await GET(makeRequest(`name-${i}`, '203.0.113.7'));
    }
    expect((await GET(makeRequest('x', '203.0.113.7'))).status).toBe(429);

    // A different client IP must be unaffected.
    expect((await GET(makeRequest('y', '198.51.100.9'))).status).toBe(200);
  }, 30_000);

  it('keys the limit on the proxy-written XFF entry, not a spoofable one', async () => {
    // All of these carry a different forged leftmost entry but the same real
    // (rightmost-trusted) address, so they must share one bucket. If the
    // leftmost were trusted, each would get a fresh budget and the limit would
    // be bypassable outright.
    for (let i = 0; i < 30; i += 1) {
      await GET(makeRequest(`n-${i}`, `10.0.0.${i}, 203.0.113.7`));
    }
    const limited = await GET(makeRequest('z', '10.9.9.9, 203.0.113.7'));
    expect(limited.status).toBe(429);
  }, 30_000);

  it('equalises response time across the taken and available branches', async () => {
    mockGetStatus.mockResolvedValue({ found: true });
    const takenStart = Date.now();
    await GET(makeRequest('taken-one'));
    const takenMs = Date.now() - takenStart;

    clearRateLimitStore();
    mockGetStatus.mockResolvedValue({ found: false });
    const freeStart = Date.now();
    await GET(makeRequest('free-one'));
    const freeMs = Date.now() - freeStart;

    // Both branches must land on the floor rather than returning as fast as
    // their own work allows.
    expect(takenMs).toBeGreaterThanOrEqual(290);
    expect(freeMs).toBeGreaterThanOrEqual(290);
  }, 10_000);

  it('pads the short-circuit branch too, so an invalid name is not distinguishable', async () => {
    const start = Date.now();
    const res = await GET(makeRequest('a'));
    expect(Date.now() - start).toBeGreaterThanOrEqual(290);
    await expect(res.json()).resolves.toMatchObject({ available: null, reason: 'empty' });
  }, 10_000);

  it('degrades to null without leaking the failure shape when the lookup throws', async () => {
    mockGetStatus.mockRejectedValue(new Error('daemon down'));
    const start = Date.now();
    const res = await GET(makeRequest('some-name'));
    expect(Date.now() - start).toBeGreaterThanOrEqual(290);
    await expect(res.json()).resolves.toMatchObject({
      available: null,
      reason: 'lookup_failed',
    });
  }, 10_000);
});
