/**
 * Unit tests for signupAction / startSignupPayment / completeSignup.
 *
 * The property under test throughout is ORDERING. Self-serve signup is split
 * across two screens so that nothing persistent, billable or tenant-visible
 * exists for an email address before somebody has proven they can receive mail
 * at it:
 *
 *   signupAction        — asks the daemon to send a link. Creates NOTHING else.
 *   startSignupPayment  — first billing call, and it needs the redeemed-session
 *                         cookie, so it cannot run before the link is opened.
 *   completeSignup      — creates the account, again only with that cookie.
 *
 * The regression these guard against is the previous shape, which created a
 * Stripe customer and a SetupIntent in step one, from an anonymous form post.
 *
 * All external dependencies (SignupService RPC wrappers, daemon provisioning
 * status, rate-limit, progress-store, billing, next/headers) are mocked so the
 * tests run without a cluster.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ConnectError, Code } from '@connectrpc/connect';

import type { TenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';

// ---------------------------------------------------------------------------
// Mocks, must precede the subject import so Vitest's module registry sees them
// ---------------------------------------------------------------------------

// next/headers: a header bag and a cookie jar the tests drive directly.
const { mockCookieStore, mockHeaderBag } = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    mockCookieStore: {
      store,
      get: (name: string) =>
        store.has(name) ? { name, value: store.get(name) } : undefined,
      set: (opts: { name: string; value: string; maxAge?: number }) => {
        if (opts.maxAge === 0) store.delete(opts.name);
        else store.set(opts.name, opts.value);
      },
    },
    mockHeaderBag: new Map<string, string>(),
  };
});
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
  headers: vi.fn(async () => ({
    get: (k: string) => mockHeaderBag.get(k) ?? null,
  })),
}));

// The four SignupService RPC wrappers.
const {
  mockRequestSignupVerification,
  mockAttachSignupCustomer,
  mockCompleteSignupOwner,
} = vi.hoisted(() => ({
  mockRequestSignupVerification: vi.fn(),
  mockAttachSignupCustomer: vi.fn(),
  mockCompleteSignupOwner: vi.fn(),
}));
vi.mock('@/src/lib/signup/owner-provisioning', () => ({
  requestSignupVerification: mockRequestSignupVerification,
  attachSignupCustomer: mockAttachSignupCustomer,
  completeSignupOwner: mockCompleteSignupOwner,
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

// Daemon tenant-provisioning status read (dashboard#813): the slug-availability
// probe and the post-provision ready poll. The dashboard holds no Kubernetes
// access, so there is no Tenant CR write to assert.
const { mockGetTenantProvisioningStatus } = vi.hoisted(() => ({
  mockGetTenantProvisioningStatus: vi.fn(),
}));
vi.mock('@/src/lib/gibson-client/provisioning', () => ({
  getTenantProvisioningStatus: mockGetTenantProvisioningStatus,
}));

const {
  mockFindOrCreateSignupCustomer,
  mockCreateSetupIntent,
  mockCreateTrialingSubscription,
  mockFinalizeSignupCustomer,
  mockVerifySignupCustomer,
} = vi.hoisted(() => ({
  mockFindOrCreateSignupCustomer: vi.fn().mockResolvedValue('cus_1'),
  mockCreateSetupIntent: vi.fn().mockResolvedValue({ client_secret: 'seti_secret_123' }),
  mockCreateTrialingSubscription: vi.fn().mockResolvedValue({ id: 'sub_1', status: 'trialing' }),
  mockFinalizeSignupCustomer: vi.fn().mockResolvedValue(undefined),
  mockVerifySignupCustomer: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/src/lib/billing/stripe', () => ({
  findOrCreateSignupCustomer: mockFindOrCreateSignupCustomer,
  createSetupIntent: mockCreateSetupIntent,
  createTrialingSubscription: mockCreateTrialingSubscription,
  finalizeSignupCustomer: mockFinalizeSignupCustomer,
  verifySignupCustomer: mockVerifySignupCustomer,
  priceIdForTier: vi.fn(async () => 'price_team_123'),
}));

// Breached-password gate. Mocked so the suite never reaches out to HIBP; the
// gate's own policy (refuse / allow / fail-open) is covered in
// src/lib/auth/__tests__/breached-password-gate.test.ts. Defaults to "allowed"
// so every pre-existing ordering test is unaffected.
const { mockAssertPasswordNotBreached } = vi.hoisted(() => ({
  mockAssertPasswordNotBreached: vi.fn(),
}));
vi.mock('@/src/lib/auth/breached-password-gate', () => ({
  assertPasswordNotBreached: mockAssertPasswordNotBreached,
}));

// After mocks are set up, import the subject.
import { signupAction, startSignupPayment, completeSignup } from '../signup';
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';
import {
  SIGNUP_VERIFIED_COOKIE,
  encodeVerifiedSession,
} from '@/src/lib/signup/verified-session';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_INPUT = {
  firstName: 'Test',
  lastName: 'User',
  email: 'test@example.com',
  workspaceName: 'test-workspace',
  tier: 'team',
  acceptToS: true as const,
  acceptPrivacy: true as const,
};

const STATUS_NOT_FOUND: TenantProvisioningStatus = {
  found: false,
  phase: '',
  dataPlaneReady: false,
  stores: { postgres: '', redis: '', neo4j: '' },
  zitadelOrgSlug: '',
  stripeCustomerId: '',
  billingActive: false,
  zitadelOrgReady: false,
};

// zitadelOrgSlug stays '' here even though the org is ready: the daemon
// redacts it for the unauthenticated signup-poller caller (gibson#1230).
// zitadelOrgReady is the readiness signal the poller actually reads.
const STATUS_READY: TenantProvisioningStatus = {
  found: true,
  phase: 'Provisioning',
  dataPlaneReady: true,
  stores: { postgres: 'ready', redis: 'ready', neo4j: 'ready' },
  zitadelOrgSlug: '',
  stripeCustomerId: 'cus_1',
  billingActive: true,
  zitadelOrgReady: true,
};

const ATTEMPT = 'aaaaaaaa-0000-0000-0000-000000000001';

/**
 * Put a redeemed-session cookie in the jar, as /signup/verify would.
 *
 * Goes through the real `encodeVerifiedSession`, so the cookie carries a real
 * signature. Hand-rolling the JSON here would produce a cookie the app now
 * rejects, and every test would fail for the wrong reason.
 */
function seedVerifiedSession(extra: Record<string, unknown> = {}) {
  mockCookieStore.store.set(
    SIGNUP_VERIFIED_COOKIE,
    encodeVerifiedSession({
      verifiedSessionToken: 'sess-1',
      attemptId: ATTEMPT,
      email: 'test@example.com',
      workspaceName: 'test-workspace',
      tier: 'team',
      ...extra,
    } as Parameters<typeof encodeVerifiedSession>[0]),
  );
}

/**
 * Put a FORGED cookie in the jar: valid JSON, no valid signature. This is what
 * a user editing their own cookie jar can produce, and what the signature
 * exists to reject.
 */
function seedForgedSession(extra: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    verifiedSessionToken: 'sess-1',
    attemptId: ATTEMPT,
    email: 'test@example.com',
    workspaceName: 'test-workspace',
    tier: 'team',
    ...extra,
  });
  mockCookieStore.store.set(SIGNUP_VERIFIED_COOKIE, `${payload}.${'0'.repeat(64)}`);
}

function resetMocks() {
  mockCookieStore.store.clear();
  mockHeaderBag.clear();
  mockHeaderBag.set('x-forwarded-for', '203.0.113.7');
  mockRequestSignupVerification.mockReset().mockResolvedValue(undefined);
  mockAttachSignupCustomer.mockReset().mockResolvedValue(undefined);
  mockCompleteSignupOwner
    .mockReset()
    .mockResolvedValue({ tenantId: 'test-workspace', ownerUserId: 'zid-1' });
  mockGetTenantProvisioningStatus.mockReset().mockResolvedValue(STATUS_NOT_FOUND);
  mockFindOrCreateSignupCustomer.mockClear().mockResolvedValue('cus_1');
  mockCreateSetupIntent.mockClear().mockResolvedValue({ client_secret: 'seti_secret_123' });
  mockCreateTrialingSubscription.mockClear().mockResolvedValue({ id: 'sub_1', status: 'trialing' });
  mockFinalizeSignupCustomer.mockClear();
  mockVerifySignupCustomer.mockClear().mockResolvedValue(true);
  mockAssertPasswordNotBreached.mockReset().mockResolvedValue({ allowed: true });
}

function enableSaaS() {
  // dashboard#921: billing-on requires the full SaaS knob set so the
  // deployment-profile resolver does not reject the combination as incoherent.
  process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED = 'true';
  process.env.SIGNUP_SELF_SERVE = 'true';
  process.env.WWW_URL = 'https://www.zeroroot.ai';
}

function disableSaaS() {
  delete process.env.DASHBOARD_BILLING_PAID_TIERS_ENABLED;
  delete process.env.SIGNUP_SELF_SERVE;
  delete process.env.WWW_URL;
}

// ---------------------------------------------------------------------------
// Step one: send a link, create nothing
// ---------------------------------------------------------------------------

describe('signupAction', () => {
  beforeEach(() => {
    resetMocks();
    enableSaaS();
  });
  afterEach(disableSaaS);

  it('requests a verification email and creates NOTHING else', async () => {
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_NOT_FOUND);

    const result = await signupAction(VALID_INPUT, ATTEMPT);

    expect(result.ok).toBe(true);
    expect('phase' in result && result.phase === 'verify_email').toBe(true);
    expect(mockRequestSignupVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT,
        ownerEmail: 'test@example.com',
        workspaceName: 'test-workspace',
        tier: 'team',
        clientIp: '203.0.113.7',
      }),
    );

    // This is the regression. An anonymous form post used to leave a Stripe
    // customer and a SetupIntent behind for an address that might belong to
    // someone else entirely.
    expect(mockFindOrCreateSignupCustomer).not.toHaveBeenCalled();
    expect(mockCreateSetupIntent).not.toHaveBeenCalled();
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });

  it('never sends a password with the verification request', async () => {
    await signupAction(VALID_INPUT, ATTEMPT);
    expect(mockRequestSignupVerification.mock.calls[0]?.[0]).not.toHaveProperty(
      'password',
    );
  });

  it('maps a daemon rate-limit refusal to RATE_LIMITED', async () => {
    mockRequestSignupVerification.mockRejectedValue(
      new ConnectError('too many', Code.ResourceExhausted),
    );
    const result = await signupAction(VALID_INPUT, ATTEMPT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('RATE_LIMITED');
  });

  it('rejects a company name that is already taken before sending anything', async () => {
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);
    const result = await signupAction(VALID_INPUT, ATTEMPT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WORKSPACE_TAKEN');
    expect(mockRequestSignupVerification).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Billing setup: gated on the redeemed session
// ---------------------------------------------------------------------------

describe('startSignupPayment', () => {
  beforeEach(() => {
    resetMocks();
    enableSaaS();
  });
  afterEach(disableSaaS);

  it('refuses without a redeemed-session cookie, and creates no billing object', async () => {
    const result = await startSignupPayment();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockFindOrCreateSignupCustomer).not.toHaveBeenCalled();
    expect(mockCreateSetupIntent).not.toHaveBeenCalled();
  });

  it('creates the customer + SetupIntent and pins the customer to the session', async () => {
    seedVerifiedSession();
    const result = await startSignupPayment();

    expect(result.ok).toBe(true);
    if (result.ok && 'phase' in result && result.phase === 'card') {
      expect(result.cardClientSecret).toBe('seti_secret_123');
    }
    expect(mockFindOrCreateSignupCustomer).toHaveBeenCalled();
    expect(mockCreateSetupIntent).toHaveBeenCalled();
    // Pinned daemon-side BEFORE the card form is handed to the browser, so the
    // completion call never carries a customer id the daemon has to trust.
    expect(mockAttachSignupCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        verifiedSessionToken: 'sess-1',
        stripeCustomerId: 'cus_1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Completion: also gated on the redeemed session
// ---------------------------------------------------------------------------

describe('completeSignup', () => {
  beforeEach(() => {
    resetMocks();
    enableSaaS();
  });
  afterEach(disableSaaS);

  it('refuses without a redeemed-session cookie, and creates no account', async () => {
    const result = await completeSignup({ password: 'Passw0rd!Test' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
  });

  it('creates the owner, then the subscription, and spends the session cookie', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });

    expect(result.ok).toBe(true);
    expect(mockCompleteSignupOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT,
        verifiedSessionToken: 'sess-1',
        password: 'Passw0rd!Test',
      }),
    );
    expect(mockCreateTrialingSubscription).toHaveBeenCalled();
    // The daemon consumed the session; the cookie must not survive to invite a
    // completion that can no longer succeed.
    expect(mockCookieStore.store.has(SIGNUP_VERIFIED_COOKIE)).toBe(false);
  });

  it('sends no signup-identifying fields on the completion call', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    await completeSignup({ password: 'Passw0rd!Test', paymentMethodId: 'pm_1' });

    const sent = mockCompleteSignupOwner.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const forbidden of ['ownerEmail', 'workspaceName', 'tier', 'stripeCustomerId']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
  });

  it('maps a spent or expired session to VERIFICATION_INVALID', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    mockCompleteSignupOwner.mockRejectedValue(
      new ConnectError('no longer valid', Code.PermissionDenied),
    );
    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });

  it('refuses a session cookie carrying someone else\'s customer, before creating anything', async () => {
    // The cookie is httpOnly but it is still the browser's to send: an attacker
    // holding a valid session of their own can swap in another account's
    // customer id. Stripe says it does not belong to this proven address, so
    // nothing is created and no card is attached to a stranger's billing.
    seedVerifiedSession({ stripeCustomerId: 'cus_victim' });
    mockVerifySignupCustomer.mockResolvedValue(false);

    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });

    expect(result.ok).toBe(false);
    expect(mockVerifySignupCustomer).toHaveBeenCalledWith('cus_victim', 'test@example.com');
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cookie forgery (GHSA-r74f)
  // -------------------------------------------------------------------------
  //
  // The cookie is httpOnly, which stops a script on the page reading it. It
  // does nothing about the person holding the browser. `tier` rides in this
  // cookie and the dashboard prices from it, so an unsigned cookie meant the
  // daemon could provision one plan (it resolves the tier from its own
  // verification row) while the dashboard billed for another.

  it('refuses a forged cookie outright, and bills nothing', async () => {
    seedForgedSession({ stripeCustomerId: 'cus_1' });

    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });

  it('a tier downgraded inside a genuine cookie cannot select a cheaper price', async () => {
    // Start from a REAL signed cookie on the dearer plan, then rewrite just the
    // tier to a real, cheaper, valid plan — the exact edit the attack needs.
    // `team` is a live plan id, so this does not pass merely because the forged
    // value fails plan lookup: it fails because the signature no longer holds.
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);
    const genuine = encodeVerifiedSession({
      verifiedSessionToken: 'sess-1',
      attemptId: ATTEMPT,
      email: 'test@example.com',
      workspaceName: 'test-workspace',
      tier: 'org',
      stripeCustomerId: 'cus_1',
    });
    const lastDot = genuine.lastIndexOf('.');
    const downgraded =
      genuine.slice(0, lastDot).replace('"tier":"org"', '"tier":"team"') +
      genuine.slice(lastDot);
    expect(downgraded).not.toBe(genuine);
    mockCookieStore.store.set(SIGNUP_VERIFIED_COOKIE, downgraded);

    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });

    // Refused outright, rather than subscribed at the cheaper price.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
  });

  it('subscribes on the tier the daemon put in the signed cookie', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    await completeSignup({ password: 'Passw0rd!Test', paymentMethodId: 'pm_1' });

    expect(mockCreateTrialingSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ tier: 'team' }),
    );
  });

  it('does not create a subscription when the account could not be created', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    mockCompleteSignupOwner.mockRejectedValue(
      new ConnectError('exists', Code.AlreadyExists),
    );
    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_PROVISIONED');
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Breached-password gate (GHSA-8jw6 residual)
  // -------------------------------------------------------------------------
  //
  // Same ordering property as the rest of this file: the refusal must land
  // before anything exists, so a rejected password leaves nothing behind.

  it('refuses a breached password BEFORE any account or subscription exists', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    mockAssertPasswordNotBreached.mockResolvedValue({ allowed: false, count: 24230577 });

    const result = await completeSignup({
      password: 'Passw0rd!Test',
      paymentMethodId: 'pm_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('POLICY_VIOLATION');
      expect(result.fieldErrors?.password).toBeTruthy();
      // The breach count is a property of the public corpus, but there is no
      // reason to put a number in front of the user; the copy must not carry it.
      expect(result.userMessage).not.toContain('24230577');
    }

    // Nothing was created, and nothing needs rolling back.
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
    expect(mockCreateTrialingSubscription).not.toHaveBeenCalled();
    expect(mockFinalizeSignupCustomer).not.toHaveBeenCalled();
  });

  it('runs the gate before the customer check, so a breach costs no Stripe call', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    mockAssertPasswordNotBreached.mockResolvedValue({ allowed: false, count: 5 });

    await completeSignup({ password: 'Passw0rd!Test', paymentMethodId: 'pm_1' });

    expect(mockVerifySignupCustomer).not.toHaveBeenCalled();
  });

  it('checks the password the user actually submitted', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    await completeSignup({
      password: 'correct-horse-battery-staple',
      paymentMethodId: 'pm_1',
    });

    expect(mockAssertPasswordNotBreached).toHaveBeenCalledWith(
      'correct-horse-battery-staple',
      'signup',
      'test@example.com',
    );
  });

  it('proceeds when the gate allows the password', async () => {
    seedVerifiedSession({ stripeCustomerId: 'cus_1' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);
    mockAssertPasswordNotBreached.mockResolvedValue({ allowed: true });

    await completeSignup({ password: 'Passw0rd!Test', paymentMethodId: 'pm_1' });

    expect(mockCompleteSignupOwner).toHaveBeenCalled();
  });
});
