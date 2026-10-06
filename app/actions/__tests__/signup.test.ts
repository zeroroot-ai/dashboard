// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for signupAction / completeSignup / readSignupStepState /
 * finishSignupAfterStep.
 *
 * The property under test throughout is ORDERING. Self-serve signup is split
 * across two screens so that nothing persistent or tenant-visible exists for
 * an email address before somebody has proven they can receive mail at it:
 *
 *   signupAction        — asks the daemon to send a link. Creates NOTHING else.
 *   completeSignup      — creates the account, only with the redeemed-session
 *                         cookie. With an external signup step configured
 *                         daemon-side (gibson#895), it hands the browser to
 *                         the step instead of waiting for the workspace.
 *
 * The dashboard creates no billing object at any point (dashboard#226).
 *
 * All external dependencies (SignupService RPC wrappers, daemon provisioning
 * status, rate-limit, progress-store, next/headers) are mocked so the tests
 * run without a cluster.
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

// The SignupService RPC wrappers.
const {
  mockRequestSignupVerification,
  mockCompleteSignupOwner,
  mockGetSignupStep,
} = vi.hoisted(() => ({
  mockRequestSignupVerification: vi.fn(),
  mockCompleteSignupOwner: vi.fn(),
  mockGetSignupStep: vi.fn(),
}));
vi.mock('@/src/lib/signup/owner-provisioning', () => ({
  requestSignupVerification: mockRequestSignupVerification,
  completeSignupOwner: mockCompleteSignupOwner,
  getSignupStep: mockGetSignupStep,
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
import {
  signupAction,
  completeSignup,
  readSignupStepState,
  finishSignupAfterStep,
} from '../signup';
import { getTenantProvisioningStatus } from '@/src/lib/gibson-client/provisioning';
import {
  SIGNUP_VERIFIED_COOKIE,
  decodeVerifiedSession,
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
  zitadelOrgReady: false,
};

// There is no zitadelOrgSlug to seed here: the daemon redacts it for the
// unauthenticated signup-poller caller
// (gibson#1230), so TenantProvisioningStatus does not carry them at all
// (dashboard#1016). zitadelOrgReady is the readiness signal the poller reads.
const STATUS_READY: TenantProvisioningStatus = {
  found: true,
  phase: 'Provisioning',
  dataPlaneReady: true,
  stores: { postgres: 'ready', redis: 'ready', neo4j: 'ready' },
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
  mockCompleteSignupOwner.mockReset().mockResolvedValue({
    tenantId: 'test-workspace',
    ownerUserId: 'zid-1',
    stepUrl: '',
    stepToken: '',
  });
  mockGetSignupStep.mockReset().mockResolvedValue('none');
  mockGetTenantProvisioningStatus.mockReset().mockResolvedValue(STATUS_NOT_FOUND);
  mockAssertPasswordNotBreached.mockReset().mockResolvedValue({ allowed: true });
}

/** The six step texts. The values are test fixtures, not product text. */
const STEP_TEXT_ENV: Record<string, string> = {
  DASHBOARD_SIGNUP_STEP_TITLE: 'step-title',
  DASHBOARD_SIGNUP_STEP_TEXT: 'step-text',
  DASHBOARD_SIGNUP_STEP_BUTTON_LABEL: 'step-button',
  DASHBOARD_SIGNUP_STEP_WAITING_TEXT: 'step-waiting',
  DASHBOARD_SIGNUP_STEP_FAILURE_TEXT: 'step-failure',
  DASHBOARD_SIGNUP_STEP_RETRY_LABEL: 'step-retry',
};

function enableSaaS() {
  process.env.SIGNUP_SELF_SERVE = 'true';
  process.env.WWW_URL = 'https://www.zeroroot.ai';
  Object.assign(process.env, STEP_TEXT_ENV);
}

function disableSaaS() {
  delete process.env.SIGNUP_SELF_SERVE;
  delete process.env.WWW_URL;
  for (const key of Object.keys(STEP_TEXT_ENV)) delete process.env[key];
}

/** The daemon holds the tenant for an external step (gibson#895). */
function withStep() {
  mockCompleteSignupOwner.mockResolvedValue({
    tenantId: 'test-workspace',
    ownerUserId: 'zid-1',
    stepUrl: 'https://billing.example.test/signup-step',
    stepToken: 'opaque-token',
  });
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

    // No account exists for an address nobody has proven they control.
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
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

  it('creates the owner and spends the session cookie', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    const result = await completeSignup({
      password: 'Passw0rd!Test'
    });

    expect(result.ok).toBe(true);
    expect(mockCompleteSignupOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT,
        verifiedSessionToken: 'sess-1',
        password: 'Passw0rd!Test',
      }),
    );
    // The daemon consumed the session. The cookie stays, marked spent, so the
    // completion page can send a returning browser to /login (dashboard#79).
    // Deleting it here re-rendered the route inside the action's response and
    // the page redirected to /signup?verify=invalid before /login was reached.
    const spent = decodeVerifiedSession(mockCookieStore.store.get(SIGNUP_VERIFIED_COOKIE));
    expect(spent?.spent).toBe(true);
    expect(spent?.attemptId).toBe(ATTEMPT);
  });

  it('refuses a second completion on a spent session', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);
    const first = await completeSignup({ password: 'Passw0rd!Test' });
    expect(first.ok).toBe(true);
    mockCompleteSignupOwner.mockClear();

    // The spent cookie is no capability: the action must not reach the daemon.
    const second = await completeSignup({ password: 'Passw0rd!Test' });
    expect(second.ok).toBe(false);
    expect(second).toMatchObject({ code: 'VERIFICATION_INVALID' });
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
  });

  it('sends no signup-identifying fields on the completion call', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    await completeSignup({ password: 'Passw0rd!Test' });

    const sent = mockCompleteSignupOwner.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const forbidden of ['ownerEmail', 'workspaceName', 'tier']) {
      expect(sent).not.toHaveProperty(forbidden);
    }
  });

  it('maps a spent or expired session to VERIFICATION_INVALID', async () => {
    seedVerifiedSession();
    mockCompleteSignupOwner.mockRejectedValue(
      new ConnectError('no longer valid', Code.PermissionDenied),
    );
    const result = await completeSignup({
      password: 'Passw0rd!Test'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
  });

  // -------------------------------------------------------------------------
  // Cookie forgery (GHSA-r74f)
  // -------------------------------------------------------------------------
  //
  // The cookie is httpOnly, which stops a script on the page reading it. It
  // does nothing about the person holding the browser. The cookie carries the
  // tier and, after completion, the step link, so an unsigned cookie could
  // send the user somewhere else.

  it('refuses a forged cookie outright, and creates nothing', async () => {
    seedForgedSession();

    const result = await completeSignup({
      password: 'Passw0rd!Test'
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
  });

  it('a tier changed inside a genuine cookie is refused', async () => {
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
    });
    const lastDot = genuine.lastIndexOf('.');
    const downgraded =
      genuine.slice(0, lastDot).replace('"tier":"org"', '"tier":"team"') +
      genuine.slice(lastDot);
    expect(downgraded).not.toBe(genuine);
    mockCookieStore.store.set(SIGNUP_VERIFIED_COOKIE, downgraded);

    const result = await completeSignup({
      password: 'Passw0rd!Test'
    });

    // Refused outright.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VERIFICATION_INVALID');
    expect(mockCompleteSignupOwner).not.toHaveBeenCalled();
  });

  it('maps an existing account to ALREADY_PROVISIONED', async () => {
    seedVerifiedSession();
    mockCompleteSignupOwner.mockRejectedValue(
      new ConnectError('exists', Code.AlreadyExists),
    );
    const result = await completeSignup({
      password: 'Passw0rd!Test'
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ALREADY_PROVISIONED');
  });

  // -------------------------------------------------------------------------
  // Breached-password gate (GHSA-8jw6 residual)
  // -------------------------------------------------------------------------
  //
  // Same ordering property as the rest of this file: the refusal must land
  // before anything exists, so a rejected password leaves nothing behind.

  it('refuses a breached password BEFORE any account exists', async () => {
    seedVerifiedSession();
    mockAssertPasswordNotBreached.mockResolvedValue({ allowed: false, count: 24230577 });

    const result = await completeSignup({
      password: 'Passw0rd!Test'
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
  });

  it('checks the password the user actually submitted', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    await completeSignup({
      password: 'correct-horse-battery-staple'
    });

    expect(mockAssertPasswordNotBreached).toHaveBeenCalledWith(
      'correct-horse-battery-staple',
      'signup',
      'test@example.com',
    );
  });

  it('proceeds when the gate allows the password', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);
    mockAssertPasswordNotBreached.mockResolvedValue({ allowed: true });

    await completeSignup({ password: 'Passw0rd!Test' });

    expect(mockCompleteSignupOwner).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// External signup step (gibson#895, dashboard#226)
// ---------------------------------------------------------------------------

describe('external signup step', () => {
  beforeEach(() => {
    resetMocks();
    enableSaaS();
  });
  afterEach(disableSaaS);

  it('with no step from the daemon, waits for the workspace as before', async () => {
    seedVerifiedSession();
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    const result = await completeSignup({ password: 'Passw0rd!Test' });

    expect(result).toMatchObject({ ok: true, redirect: expect.any(String) });
    const spent = decodeVerifiedSession(mockCookieStore.store.get(SIGNUP_VERIFIED_COOKIE));
    expect(spent?.stepLink).toBeUndefined();
  });

  it('with a step, returns the external_step phase and keeps the link with the token', async () => {
    seedVerifiedSession();
    withStep();

    const result = await completeSignup({ password: 'Passw0rd!Test' });

    expect(result).toMatchObject({ ok: true, phase: 'external_step', attemptId: ATTEMPT });
    // It does not wait for the workspace: the tenant waits for the step.
    expect(mockGetTenantProvisioningStatus).not.toHaveBeenCalled();
    const spent = decodeVerifiedSession(mockCookieStore.store.get(SIGNUP_VERIFIED_COOKIE));
    expect(spent?.spent).toBe(true);
    expect(spent?.tenantSlug).toBe('test-workspace');
    expect(spent?.stepLink).toBe('https://billing.example.test/signup-step?token=opaque-token');
  });

  it('with a step and no step texts in config, fails without sending the browser anywhere', async () => {
    seedVerifiedSession();
    withStep();
    for (const key of Object.keys(STEP_TEXT_ENV)) delete process.env[key];

    const result = await completeSignup({ password: 'Passw0rd!Test' });

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });

  it('reads the step state of the attempt in the cookie, never of a caller value', async () => {
    seedVerifiedSession();
    withStep();
    await completeSignup({ password: 'Passw0rd!Test' });
    mockGetSignupStep.mockResolvedValue('waiting');

    await expect(readSignupStepState()).resolves.toBe('waiting');
    expect(mockGetSignupStep).toHaveBeenCalledWith(ATTEMPT);
  });

  it('reports none with no completed session', async () => {
    seedVerifiedSession();
    await expect(readSignupStepState()).resolves.toBe('none');
    expect(mockGetSignupStep).not.toHaveBeenCalled();
  });

  it('after the step, waits for the tenant from the cookie and redirects to login', async () => {
    seedVerifiedSession();
    withStep();
    await completeSignup({ password: 'Passw0rd!Test' });
    vi.mocked(getTenantProvisioningStatus).mockResolvedValue(STATUS_READY);

    const result = await finishSignupAfterStep();

    expect(result).toMatchObject({ ok: true, redirect: expect.any(String) });
    expect(mockGetTenantProvisioningStatus).toHaveBeenCalledWith('test-workspace');
  });

  it('refuses to finish with no completed session', async () => {
    seedVerifiedSession();
    const result = await finishSignupAfterStep();
    expect(result).toMatchObject({ ok: false, code: 'VERIFICATION_INVALID' });
  });
});
