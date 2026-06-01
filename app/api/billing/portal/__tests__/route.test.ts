/**
 * @vitest-environment node
 *
 * Unit tests for the Stripe portal route handler at
 * app/api/billing/portal/route.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockCreatePortalSession = vi.fn();
vi.mock('@/src/lib/billing/stripe', () => ({
  createPortalSession: (...args: unknown[]) => mockCreatePortalSession(...args),
}));

const mockGetTenant = vi.fn();
vi.mock('@/src/lib/k8s/tenants', () => ({
  getTenant: (...args: unknown[]) => mockGetTenant(...args),
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

const mockReadRawActiveTenant = vi.fn();
vi.mock('@/src/lib/auth/active-tenant', () => ({
  readRawActiveTenant: (...args: unknown[]) => mockReadRawActiveTenant(...args),
}));

let mockRateLimitAllowed = true;
vi.mock('@/src/lib/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockImplementation(() =>
    Promise.resolve({
      allowed: mockRateLimitAllowed,
      current: 1,
      limit: 20,
      remaining: 19,
      resetIn: 60,
      resetAt: Math.ceil((Date.now() + 60000) / 1000),
    }),
  ),
}));

vi.mock('@/src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import handler
// ---------------------------------------------------------------------------

import { POST } from '../route';
// Import AuthzDeniedError from the mock to use in tests
import { AuthzDeniedError } from '@/src/lib/auth/assert-authorized';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost:3000/api/billing/portal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '1.2.3.4',
    },
    body: JSON.stringify({}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/billing/portal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PUBLIC_URL is REQUIRED at boot per one-code-path/206 — set it here so
    // the route's defence check doesn't short-circuit every test.
    process.env.PUBLIC_URL = 'https://app.zeroroot.local:30443';
    mockRateLimitAllowed = true;
    mockAssertAuthorizedShouldThrow = null;
    mockReadRawActiveTenant.mockResolvedValue({
      status: 'present',
      tenantId: 'acme',
    });
    mockGetTenant.mockResolvedValue({
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'Tenant',
      metadata: { name: 'acme' },
      spec: {
        displayName: 'Acme Inc',
        owner: 'alice',
        tier: 'team',
        stripeCustomerId: 'cus_test123',
      },
      status: {},
    });
    mockCreatePortalSession.mockResolvedValue({
      id: 'bps_test123',
      url: 'https://billing.stripe.com/session/test123',
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      mockRateLimitAllowed = false;
      const res = await POST(makeRequest());
      expect(res.status).toBe(429);
      const json = await res.json() as { error: string };
      expect(json.error).toBe('rate limit exceeded');
    });
  });

  describe('auth gating', () => {
    it('returns 403 when assertAuthorized throws AuthzDeniedError', async () => {
      mockAssertAuthorizedShouldThrow = new AuthzDeniedError(
        '/gibson.tenant.v1.SecretsService/CountSecrets',
        'not-a-member',
      );
      const res = await POST(makeRequest());
      expect(res.status).toBe(403);
      const json = await res.json() as { error: string };
      expect(json.error).toBe('permission denied');
    });

    it('re-throws non-authz errors from assertAuthorized', async () => {
      mockAssertAuthorizedShouldThrow = new Error('Internal error');
      await expect(POST(makeRequest())).rejects.toThrow('Internal error');
    });
  });

  describe('tenant validation', () => {
    it('returns 400 when stripeCustomerId is missing on tenant', async () => {
      mockGetTenant.mockResolvedValue({
        apiVersion: 'gibson.zeroroot.ai/v1alpha1',
        kind: 'Tenant',
        metadata: { name: 'acme' },
        spec: {
          displayName: 'Acme Inc',
          owner: 'alice',
          tier: 'team',
          // stripeCustomerId intentionally absent
        },
        status: {},
      });
      const res = await POST(makeRequest());
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toBe('no billing customer');
    });

    it('returns 400 when there is no active tenant', async () => {
      mockReadRawActiveTenant.mockResolvedValue({ status: 'absent' });
      const res = await POST(makeRequest());
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toBe('no active tenant');
    });
  });

  describe('successful portal session creation', () => {
    it('returns { url } for an authenticated tenant admin with a customer', async () => {
      const res = await POST(makeRequest());
      expect(res.status).toBe(200);
      const json = await res.json() as { url: string };
      expect(json.url).toBe('https://billing.stripe.com/session/test123');
    });

    it('passes correct customerId and returnUrl to createPortalSession', async () => {
      await POST(makeRequest());
      expect(mockCreatePortalSession).toHaveBeenCalledOnce();
      const [params] = mockCreatePortalSession.mock.calls[0] as [{ customerId: string; returnUrl: string; idempotencyKey: string }];
      expect(params.customerId).toBe('cus_test123');
      expect(params.returnUrl).toContain('/dashboard/pages/settings/billing');
    });

    it('uses 10-second bucket idempotency key', async () => {
      await POST(makeRequest());
      const [params] = mockCreatePortalSession.mock.calls[0] as [{ idempotencyKey: string }];
      expect(params.idempotencyKey).toMatch(/^tenant:acme:portal:\d+$/);
    });
  });

  describe('Stripe error handling', () => {
    it('returns 503 on Stripe API error', async () => {
      mockCreatePortalSession.mockRejectedValue(new Error('Stripe timeout'));
      const res = await POST(makeRequest());
      expect(res.status).toBe(503);
      const json = await res.json() as { error: string };
      expect(json.error).toBe('billing temporarily unavailable');
    });
  });
});
