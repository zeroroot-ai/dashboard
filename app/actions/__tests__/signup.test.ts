/**
 * Unit tests for signupAction + completeSignup.
 *
 * E9 (dashboard#812): the dashboard no longer holds a Zitadel signup-bot PAT.
 * Founding-owner provisioning runs daemon-side via the unauthenticated
 * gibson.tenant.v1.SignupService.Signup RPC, surfaced here through
 * `provisionSignupOwner`. These tests assert:
 *   - signupAction calls provisionSignupOwner with the founding-owner fields
 *     and always redirects to /login (no auto-login);
 *   - a daemon policy rejection maps to POLICY_VIOLATION;
 *   - the card-first phases behave unchanged.
 *
 * All external dependencies (owner-provisioning RPC, K8s, rate-limit,
 * progress-store, billing, next/headers) are mocked so the tests run without
 * a cluster.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ConnectError, Code } from '@connectrpc/connect';

import type { Tenant } from '@/src/lib/k8s/types';

// ---------------------------------------------------------------------------
// Mocks, must precede the subject import so Vitest's module registry sees them
// ---------------------------------------------------------------------------

// Mock next/headers (not available outside the Next.js runtime)
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

// Mock the daemon owner-provisioning RPC wrapper (replaces the retired Zitadel
// signup-bot admin client). vi.hoisted so the spy is available to the hoisted
// vi.mock factory below.
const { mockProvisionSignupOwner } = vi.hoisted(() => ({
  mockProvisionSignupOwner: vi.fn(),
}));
vi.mock('@/src/lib/signup/owner-provisioning', () => ({
  provisionSignupOwner: mockProvisionSignupOwner,
}));

// Mock rate-limit to always allow.
vi.mock('@/src/lib/signup/rate-limit', () => ({
  checkSignupRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterMs: 0 }),
}));

// Mock progress-store, no daemon RPC needed.
vi.mock('@/src/lib/signup/progress-store', () => ({
  advanceStep: vi.fn().mockResolvedValue(undefined),
  completeProgress: vi.fn().mockResolvedValue(undefined),
  failProgress: vi.fn().mockResolvedValue(undefined),
}));

// Mock K8s tenants, no workspace conflict, tenant ready immediately.
//
// dashboard#813: signup no longer writes the Tenant CR — the daemon Signup RPC
// enqueues the tenant and the tenant-operator creates the CR (gibson#949). So
// `applyTenant` is NOT mocked here and the action must not call it; signup's
// only remaining Tenant-CR-namespace K8s writes are the founding-owner
// TenantMember (applyTenantMember) once the operator-created Tenant is ready.
const mockTenant = {
  metadata: { name: 'test-workspace', namespace: 'gibson' },
  spec: {},
  status: { phase: 'Active', zitadelOrgID: 'mock-org-123' },
};
// Real k8s().get throws on 404; the production code's safeGetTenant catches
// the not-found error and treats it as "no existing tenant". Modeling the
// reject (instead of resolving null) keeps the mock faithful to the real
// `(name) => Promise<Tenant>` signature. applyTenantMember has no observable
// return contract at the call sites here (the action awaits it but doesn't read
// the value), so a cast through unknown is enough.
vi.mock('@/src/lib/k8s/tenants', () => ({
  applyTenantMember: vi.fn().mockResolvedValue(undefined as unknown as Tenant),
  getTenant: vi.fn().mockRejectedValue(new Error('tenant not found: 404')),
  tenantNamespace: vi.fn((slug: string) => `tenant-${slug}`),
}));

// Mock K8s client for TenantMember polling, immediately Active.
vi.mock('@/src/lib/k8s/client', () => ({
  k8s: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({
      status: { phase: 'Active' },
    }),
    apply: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the billing/stripe surface (card-first signup, dashboard#785). Use
// vi.hoisted so the mock fns are initialised in the hoisted phase, before the
// (also-hoisted) vi.mock factory below references them.
const {
  mockFindOrCreateSignupCustomer,
  mockCreateSetupIntent,
  mockVerifySignupCustomer,
  mockCreateTrialingSubscription,
  mockFinalizeSignupCustomer,
} = vi.hoisted(() => ({
  mockFindOrCreateSignupCustomer: vi.fn().mockResolvedValue('cus_1'),
  mockCreateSetupIntent: vi.fn().mockResolvedValue({ client_secret: 'seti_secret_123' }),
  mockVerifySignupCustomer: vi.fn().mockResolvedValue(true),
  mockCreateTrialingSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'trialing' }),
  mockFinalizeSignupCustomer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/billing/stripe', () => ({
  findOrCreateSignupCustomer: mockFindOrCreateSignupCustomer,
  createSetupIntent: mockCreateSetupIntent,
  verifySignupCustomer: mockVerifySignupCustomer,
  createTrialingSubscription: mockCreateTrialingSubscription,
  finalizeSignupCustomer: mockFinalizeSignupCustomer,
  priceIdForTier: vi.fn(() => 'price_team_123'),
}));
// NOTE: @/src/generated/plans is NOT mocked — the real lookupPlan() returns
// the registry's trialDays, and pricing-display.ts (pulled in transitively via
// types.ts) needs the real `plans` array. priceIdForTier is mocked above so
// the env-backed price lookup doesn't matter here.

// After mocks are set up, import the subject.
import { signupAction, completeSignup } from '../signup';
import { getTenant, applyTenantMember } from '@/src/lib/k8s/tenants';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  password: 'Passw0rd!Test',
  passwordConfirm: 'Passw0rd!Test',
  workspaceName: 'test-workspace',
  tier: 'team',
  acceptToS: true as const,
  acceptPrivacy: true as const,
};

const OWNER_OK = {
  tenantId: 'test-workspace',
  ownerUserId: 'zitadel-user-123',
  alreadyExisted: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset all call counts between tests. */
function resetMocks() {
  mockProvisionSignupOwner.mockReset().mockResolvedValue(OWNER_OK);
  vi.mocked(getTenant).mockRejectedValue(new Error('tenant not found: 404'));
  vi.mocked(applyTenantMember).mockClear();
  mockFindOrCreateSignupCustomer.mockClear().mockResolvedValue('cus_1');
  mockCreateSetupIntent.mockClear().mockResolvedValue({ client_secret: 'seti_secret_123' });
  mockVerifySignupCustomer.mockClear().mockResolvedValue(true);
  mockCreateTrialingSubscription.mockClear().mockResolvedValue({ id: 'sub_1', status: 'trialing' });
  mockFinalizeSignupCustomer.mockClear();
}

/** getTenant: first call 404 (name available), subsequent calls ready. */
function tenantAvailableThenReady() {
  let n = 0;
  vi.mocked(getTenant).mockImplementation(async () => {
    n++;
    if (n === 1) throw new Error('tenant not found: 404');
    return mockTenant as Tenant;
  });
}

// ---------------------------------------------------------------------------
// Tests: daemon owner provisioning + /login redirect (E9, dashboard#812)
// ---------------------------------------------------------------------------

describe('signupAction, daemon owner provisioning (E9, dashboard#812)', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('provisions the founding owner via the daemon Signup RPC with the form fields', async () => {
    tenantAvailableThenReady();

    const result = await signupAction(VALID_INPUT, 'aaaaaaaa-0000-0000-0000-000000000001');

    expect(result.ok).toBe(true);
    expect(mockProvisionSignupOwner).toHaveBeenCalledTimes(1);
    expect(mockProvisionSignupOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: 'aaaaaaaa-0000-0000-0000-000000000001',
        ownerEmail: VALID_INPUT.email.toLowerCase(),
        workspaceName: VALID_INPUT.workspaceName,
        tier: VALID_INPUT.tier,
        ownerFirstName: VALID_INPUT.firstName,
        ownerLastName: VALID_INPUT.lastName,
        password: VALID_INPUT.password,
      }),
    );
  });

  it('always redirects to /login after a successful signup (no auto-login)', async () => {
    tenantAvailableThenReady();

    const result = await signupAction(VALID_INPUT, 'aaaaaaaa-0000-0000-0000-000000000002');

    expect(result.ok).toBe(true);
    if (result.ok && 'redirect' in result) {
      expect(result.redirect).toBe('/login?callbackUrl=%2Fdashboard');
    } else {
      throw new Error('expected a redirect result');
    }
  });

  it('maps a daemon InvalidArgument (policy rejection) to POLICY_VIOLATION', async () => {
    tenantAvailableThenReady();
    mockProvisionSignupOwner.mockRejectedValueOnce(
      new ConnectError('password does not meet complexity policy', Code.InvalidArgument),
    );

    const result = await signupAction(VALID_INPUT, 'aaaaaaaa-0000-0000-0000-000000000003');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('POLICY_VIOLATION');
    }
    // No TenantMember CR is applied when owner provisioning fails (and the
    // dashboard never writes the Tenant CR at all — the operator does, off the
    // daemon's pending-provisioning queue; dashboard#813).
    expect(applyTenantMember).not.toHaveBeenCalled();
  });

  it('maps a daemon Unavailable to ZITADEL_UNAVAILABLE', async () => {
    tenantAvailableThenReady();
    mockProvisionSignupOwner.mockRejectedValueOnce(
      new ConnectError('identity service down', Code.Unavailable),
    );

    const result = await signupAction(VALID_INPUT, 'aaaaaaaa-0000-0000-0000-000000000004');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ZITADEL_UNAVAILABLE');
    }
  });
});

// ---------------------------------------------------------------------------
// Card-first signup (dashboard#785): phase 1 creates ONLY the Stripe customer +
// SetupIntent; phase 2 (completeSignup) creates the subscription, account, and
// company AFTER the card clears. Nothing is created until the card clears.
// ---------------------------------------------------------------------------

const COMPLETE_INPUT = {
  attemptId: 'aaaaaaaa-0000-0000-0000-0000000000aa',
  stripeCustomerId: 'cus_1',
  paymentMethodId: 'pm_1',
  tenantSlug: 'test-workspace',
  tier: 'team',
  email: 'test@example.com',
  password: 'Passw0rd!Test',
  workspaceName: 'test-workspace',
  firstName: 'Test',
  lastName: 'User',
};

describe('card-first signup phase 1 (signupAction → card)', () => {
  beforeEach(() => {
    resetMocks();
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
  });

  it('creates ONLY the Stripe customer + SetupIntent and returns the card phase — no account/company', async () => {
    // Step-3 availability check → 404 (name available).
    vi.mocked(getTenant).mockRejectedValue(new Error('tenant not found: 404'));
    const result = await signupAction(VALID_INPUT, 'aaaaaaaa-0000-0000-0000-0000000000b1');
    expect(result.ok).toBe(true);
    expect('phase' in result && result.phase === 'card').toBe(true);
    if ('phase' in result && result.phase === 'card') {
      expect(result.cardClientSecret).toBe('seti_secret_123');
      expect(result.stripeCustomerId).toBe('cus_1');
      expect(result.tenantSlug).toBe('test-workspace');
      expect(result.tier).toBe('team');
    }
    expect(mockFindOrCreateSignupCustomer).toHaveBeenCalled();
    expect(mockCreateSetupIntent).toHaveBeenCalled();
    // Nothing is created until the card clears: no owner provisioning (which is
    // what enqueues the tenant for the operator) and no TenantMember write.
    expect(mockProvisionSignupOwner).not.toHaveBeenCalled();
    expect(applyTenantMember).not.toHaveBeenCalled();
  });
});

describe('card-first signup phase 2 (completeSignup)', () => {
  beforeEach(() => {
    resetMocks();
    process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
    mockProvisionSignupOwner.mockResolvedValue({
      tenantId: 'test-workspace',
      ownerUserId: 'zid-1',
      alreadyExisted: false,
    });
  });
  afterEach(() => {
    delete process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
  });

  it('provisions owner (pinned customer, enqueues tenant) → subscription → provisions', async () => {
    // First getTenant (slug race guard) → 404 (free); later calls
    // (waitForTenantReady) → ready org, modelling the operator having created
    // the Tenant CR asynchronously off its pending-provisioning queue.
    let n = 0;
    vi.mocked(getTenant).mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('tenant not found: 404');
      return {
        spec: { owner: 'test@example.com' },
        status: { zitadelOrgID: 'org-1', phase: 'Provisioning' },
      } as unknown as Tenant;
    });
    const result = await completeSignup(COMPLETE_INPUT);
    expect(result.ok).toBe(true);
    expect(mockCreateTrialingSubscription).toHaveBeenCalled();
    // Owner provisioning (the Signup RPC) pins the pre-created Stripe customer
    // id — this is now the ONLY pinning path: the RPC carries it onto the
    // pending-provisioning row, the operator stamps it on the Tenant CR it
    // creates. The dashboard no longer writes the Tenant CR (dashboard#813).
    expect(mockProvisionSignupOwner).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_1' }),
    );
    // The founding-owner TenantMember is still written once the operator-created
    // Tenant is ready.
    expect(applyTenantMember).toHaveBeenCalled();
  });

  it('pins the Stripe customer on the Signup RPC BEFORE creating the subscription', async () => {
    // The Tenant CR is created asynchronously by the operator now, so the old
    // "apply CR before subscribe" ordering is gone. What still matters: the
    // owner-provisioning RPC (which enqueues the tenant + pins the customer id)
    // runs before the subscription, so the operator can adopt the pinned
    // customer deterministically rather than racing a Stripe metadata search.
    let n = 0;
    vi.mocked(getTenant).mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error('tenant not found: 404');
      return {
        spec: { owner: 'test@example.com' },
        status: { zitadelOrgID: 'org-1', phase: 'Provisioning' },
      } as unknown as Tenant;
    });
    await completeSignup(COMPLETE_INPUT);
    const ownerOrder = mockProvisionSignupOwner.mock.invocationCallOrder[0];
    const subOrder = mockCreateTrialingSubscription.mock.invocationCallOrder[0];
    expect(ownerOrder).toBeGreaterThan(0);
    expect(subOrder).toBeGreaterThan(ownerOrder);
  });

  it('surfaces a failure when the subscription cannot be created', async () => {
    vi.mocked(getTenant).mockRejectedValue(new Error('tenant not found: 404'));
    mockCreateTrialingSubscription.mockRejectedValueOnce(new Error('stripe_error'));
    const result = await completeSignup(COMPLETE_INPUT);
    expect(result.ok).toBe(false);
  });

  it('refuses when the customer cannot be verified for this email (anti-hijack)', async () => {
    vi.mocked(getTenant).mockRejectedValue(new Error('tenant not found: 404'));
    mockVerifySignupCustomer.mockResolvedValueOnce(false);
    const result = await completeSignup(COMPLETE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
    expect(mockProvisionSignupOwner).not.toHaveBeenCalled();
  });

  it('refuses when the company name was taken by someone else between phases', async () => {
    vi.mocked(getTenant).mockResolvedValue({
      spec: { owner: 'someone-else@example.com' },
      status: {},
    } as unknown as Tenant);
    const result = await completeSignup(COMPLETE_INPUT);
    expect(result.ok).toBe(false);
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });
});
