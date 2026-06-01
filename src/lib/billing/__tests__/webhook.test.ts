/**
 * @vitest-environment node
 *
 * Tests for the Stripe webhook route handler at
 * app/api/billing/webhook/route.ts.
 *
 * Strategy:
 * - Mock Stripe signature verification via the centralized billing helper.
 * - Mock k8s getTenant / patchTenant so no real cluster is required.
 * - Mock the DB pool so idempotency SQL runs against an in-memory stub.
 * - Mock the email provider so no real SMTP/Resend call is made.
 * - Mock emitAuthAudit to capture audit events without console noise.
 *
 * All paths return HTTP 200 except invalid signature → 400 and transient
 * infrastructure failures → 500.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks — registered BEFORE the module under test is imported so that
// vi.mock() hoisting takes effect. Each mock is configured per-test via the
// factory function's captured references.
// ---------------------------------------------------------------------------

// Shared mutable references that individual tests can override.
const mockVerifyWebhookSignature = vi.fn();
const mockRefundCharge = vi.fn();

vi.mock('@/src/lib/billing/stripe', () => ({
  verifyWebhookSignature: (...args: unknown[]) => mockVerifyWebhookSignature(...args),
  refundCharge: (...args: unknown[]) => mockRefundCharge(...args),
}));

const mockGetTenant = vi.fn();
const mockPatchTenant = vi.fn();

vi.mock('@/src/lib/k8s/tenants', () => ({
  getTenant: (...args: unknown[]) => mockGetTenant(...args),
  patchTenant: (...args: unknown[]) => mockPatchTenant(...args),
}));

// BillingService daemon RPC mocks — replaces the DB pool.
// The route now calls serviceClient(BillingService, ...) for idempotency.
const mockRecordWebhookEvent = vi.hoisted(() => vi.fn());
const mockDeleteWebhookEvent = vi.hoisted(() => vi.fn());

vi.mock('@/src/lib/gibson-client', () => ({
  serviceClient: () => ({
    recordWebhookEvent: (...args: unknown[]) => mockRecordWebhookEvent(...args),
    deleteWebhookEvent: (...args: unknown[]) => mockDeleteWebhookEvent(...args),
  }),
}));

vi.mock('@/src/gen/gibson/billing/v1/billing_pb', () => ({
  BillingService: {},
}));

const mockEmailSend = vi.fn();

vi.mock('@/src/lib/email/provider', () => ({
  getEmailProvider: () => ({ send: mockEmailSend }),
}));

// Capture audit events rather than sending them to console.
const auditEvents: unknown[] = [];
vi.mock('@/src/lib/audit/auth', () => ({
  emitAuthAudit: vi.fn().mockImplementation((event: unknown) => {
    auditEvents.push(event);
  }),
}));

// Stub all billing email templates with static return values (avoid hoisting issues).
vi.mock('@/src/lib/email/templates/billing-rollback', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Charge reversed', text: 'text', html: '<p>html</p>' }),
}));
vi.mock('@/src/lib/email/templates/billing-checkout-completed', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Trial started', text: 'text', html: '<p>html</p>' }),
}));
vi.mock('@/src/lib/email/templates/billing-trial-will-end', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Trial ending', text: 'text', html: '<p>html</p>' }),
}));
vi.mock('@/src/lib/email/templates/billing-payment-failed', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Payment failed', text: 'text', html: '<p>html</p>' }),
}));
vi.mock('@/src/lib/email/templates/billing-subscription-cancelled', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Cancelled', text: 'text', html: '<p>html</p>' }),
}));
vi.mock('@/src/lib/email/templates/billing-plan-changed', () => ({
  render: vi.fn().mockReturnValue({ to: 'u@e.com', subject: 'Plan changed', text: 'text', html: '<p>html</p>' }),
}));

// Mock logger to suppress noise.
vi.mock('@/src/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// Mock billing metrics.
vi.mock('@/src/lib/metrics/billing', () => ({
  incBillingEvent: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the route handler AFTER mocks are established.
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/billing/webhook/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NextRequest with the given body and Stripe-Signature header. */
function makeRequest(body: string, signature = 'valid-sig'): NextRequest {
  return new NextRequest('http://localhost/api/billing/webhook', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature,
    },
  });
}

/** Minimal Stripe Checkout Session fixture. */
function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_abc123',
    client_reference_id: 'acme',
    payment_intent: 'pi_test_xyz',
    customer_details: { email: 'owner@example.com' },
    customer_email: null,
    amount_total: 4900,
    currency: 'usd',
    metadata: { user_id: 'user_abc' },
    ...overrides,
  };
}

/** Build a Stripe Event fixture. */
function makeEvent(type: string, session: Record<string, unknown>) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object: session },
  };
}

/** Tenant CR with no failed conditions — provisioning OK. */
function healthyTenant() {
  return {
    metadata: { name: 'acme', annotations: {} },
    spec: { tier: 'team', owner: 'owner@example.com', displayName: 'ACME' },
    status: { conditions: [] },
  };
}

/** Tenant CR with Blocked=True — provisioning definitively failed. */
function blockedTenant() {
  return {
    metadata: { name: 'acme', annotations: {} },
    spec: { tier: 'team', owner: 'owner@example.com', displayName: 'ACME' },
    status: {
      conditions: [
        { type: 'Blocked', status: 'True', reason: 'SagaFailed', message: 'ops' },
      ],
    },
  };
}

/** Tenant CR with Ready=False/ProvisioningFailed. */
function failedTenant() {
  return {
    metadata: { name: 'acme', annotations: {} },
    spec: { tier: 'team', owner: 'owner@example.com', displayName: 'ACME' },
    status: {
      conditions: [
        { type: 'Ready', status: 'False', reason: 'ProvisioningFailed', message: 'err' },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  auditEvents.length = 0;
  // Default: new event (isNew=true), deletion succeeds.
  mockRecordWebhookEvent.mockResolvedValue({ isNew: true });
  mockDeleteWebhookEvent.mockResolvedValue({});
  mockRefundCharge.mockResolvedValue({ id: 're_test_123', status: 'succeeded' });
  mockEmailSend.mockResolvedValue(undefined);
  mockPatchTenant.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — signature verification', () => {
  it('returns 400 when Stripe-Signature header is missing', async () => {
    const req = new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when verifyWebhookSignature returns null', async () => {
    mockVerifyWebhookSignature.mockReturnValue(null);

    const res = await POST(makeRequest('{}'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid signature/i);
  });

  it('does not process any business logic on invalid signature', async () => {
    mockVerifyWebhookSignature.mockReturnValue(null);

    await POST(makeRequest('{}'));

    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
    expect(mockPatchTenant).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy path — billing confirmed
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — checkout.session.completed (confirm path)', () => {
  it('returns 200 and patches the Tenant CR with billing-active annotation', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(healthyTenant());

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [patchedSlug, patch] = mockPatchTenant.mock.calls[0];
    expect(patchedSlug).toBe('acme');
    expect(patch).toMatchObject({
      metadata: {
        annotations: {
          'gibson.zeroroot.ai/billing-active': 'true',
        },
      },
    });
  });

  it('does NOT issue a refund on healthy provisioning', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(healthyTenant());

    await POST(makeRequest(JSON.stringify(session)));

    expect(mockRefundCharge).not.toHaveBeenCalled();
  });

  it('emits billing_confirmed audit event', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(healthyTenant());

    await POST(makeRequest(JSON.stringify(session)));

    const confirmEvent = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).reason === 'billing_confirmed',
    );
    expect(confirmEvent).toBeDefined();
    expect(confirmEvent!.action).toBe('signup_completed');
    expect(confirmEvent!.targetTenant).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// Rollback path — provisioning failed
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — checkout.session.completed (rollback path)', () => {
  it('issues a refund when tenant is Blocked=True', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    expect(mockRefundCharge).toHaveBeenCalledOnce();
    const [intentId, reason] = mockRefundCharge.mock.calls[0];
    expect(intentId).toBe('pi_test_xyz');
    expect(reason).toBe('requested_by_customer');
  });

  it('issues a refund when tenant is Ready=False/ProvisioningFailed', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(failedTenant());

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    expect(mockRefundCharge).toHaveBeenCalledOnce();
  });

  it('does NOT patch the Tenant CR on rollback', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    await POST(makeRequest(JSON.stringify(session)));

    expect(mockPatchTenant).not.toHaveBeenCalled();
  });

  it('sends a rollback email on refund', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    await POST(makeRequest(JSON.stringify(session)));

    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('emits billing_rollback audit event', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    await POST(makeRequest(JSON.stringify(session)));

    const rollbackEvent = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).action === 'billing_rollback',
    );
    expect(rollbackEvent).toBeDefined();
    expect(rollbackEvent!.outcome).toBe('ok');
    expect(rollbackEvent!.reason).toBe('provisioning_failed');
    expect(rollbackEvent!.targetTenant).toBe('acme');
  });

  it('returns 200 even when email send fails (refund already issued)', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());
    mockEmailSend.mockRejectedValue(new Error('SMTP timeout'));

    const res = await POST(makeRequest(JSON.stringify(session)));

    // Refund happened; email failure is non-fatal.
    expect(res.status).toBe(200);
    expect(mockRefundCharge).toHaveBeenCalledOnce();
  });

  it('handles session with payment_intent as object (not string)', async () => {
    const session = makeSession({ payment_intent: { id: 'pi_from_object' } });
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    await POST(makeRequest(JSON.stringify(session)));

    expect(mockRefundCharge).toHaveBeenCalledWith('pi_from_object', 'requested_by_customer');
  });

  it('skips refund when payment_intent is absent', async () => {
    const session = makeSession({ payment_intent: null });
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(blockedTenant());

    // Should not throw, should not call refundCharge.
    const res = await POST(makeRequest(JSON.stringify(session)));
    expect(res.status).toBe(200);
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });

  it('returns 500 and retries when k8s getTenant throws transiently', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockRejectedValue(new Error('k8s api unavailable'));

    const res = await POST(makeRequest(JSON.stringify(session)));

    // Transient k8s failure must not issue speculative refund; 500 so Stripe retries.
    expect(res.status).toBe(500);
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Idempotency — duplicate delivery
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — idempotency', () => {
  it('returns 200 with duplicate:true on duplicate event (no side effects)', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    // Simulate duplicate: recordWebhookEvent returns isNew=false.
    mockRecordWebhookEvent.mockResolvedValue({ isNew: false });

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; duplicate: boolean };
    expect(body.duplicate).toBe(true);

    // No side effects should have fired.
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
    expect(mockPatchTenant).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('records event_id via daemon RPC on first receipt (returns 200)', async () => {
    // Default: isNew=true (set in beforeEach).
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(healthyTenant());

    const res = await POST(makeRequest(JSON.stringify(session)));

    // A new event should return 200 and process the event.
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; duplicate?: boolean };
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBeUndefined();
    // recordWebhookEvent was called.
    expect(mockRecordWebhookEvent).toHaveBeenCalledOnce();
    const [req] = mockRecordWebhookEvent.mock.calls[0] as [{ eventId: string; eventType: string }];
    expect(req.eventId).toBe(event.id);
    expect(req.eventType).toBe('checkout.session.completed');
    // Patch was called — event was processed (not duplicate-skipped).
    expect(mockPatchTenant).toHaveBeenCalled();
  });

  it('removes the idempotency record via daemon RPC when processing fails (allows retry)', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    // getTenant throws → processing fails → deleteWebhookEvent should be called.
    mockGetTenant.mockRejectedValue(new Error('k8s transient'));

    await POST(makeRequest(JSON.stringify(session)));

    // Verify deleteWebhookEvent was called with the event ID.
    expect(mockDeleteWebhookEvent).toHaveBeenCalledOnce();
    const [req] = mockDeleteWebhookEvent.mock.calls[0] as [{ eventId: string }];
    expect(req.eventId).toBe(event.id);
  });
});

// ---------------------------------------------------------------------------
// Expired / async_payment_failed events
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — checkout.session.expired and async_payment_failed', () => {
  it.each([
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ] as const)('returns 200 for %s', async (eventType) => {
    const session = makeSession();
    const event = makeEvent(eventType, session);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
  });

  it.each([
    'checkout.session.expired',
    'checkout.session.async_payment_failed',
  ] as const)('does not refund for %s', async (eventType) => {
    const session = makeSession();
    const event = makeEvent(eventType, session);
    mockVerifyWebhookSignature.mockReturnValue(event);

    await POST(makeRequest(JSON.stringify(session)));

    expect(mockRefundCharge).not.toHaveBeenCalled();
    expect(mockGetTenant).not.toHaveBeenCalled();
  });

  it('emits signup_failed audit event for expired session', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.expired', session);
    mockVerifyWebhookSignature.mockReturnValue(event);

    await POST(makeRequest(JSON.stringify(session)));

    const failedEvent = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).action === 'signup_failed',
    );
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.targetTenant).toBe('acme');
  });
});

// ---------------------------------------------------------------------------
// Missing client_reference_id
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — missing client_reference_id', () => {
  it('returns 200 but skips all business logic when client_reference_id is null', async () => {
    const session = makeSession({ client_reference_id: null });
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
    expect(mockPatchTenant).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Unhandled event types
// ---------------------------------------------------------------------------

describe('POST /api/billing/webhook — unhandled event types', () => {
  it('returns 200 and takes no action for truly unrecognised event types', async () => {
    const event = makeEvent('payment_method.attached', {});
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(200);
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// New subscription lifecycle handlers (Tasks 22-24)
// ---------------------------------------------------------------------------

/** Minimal Stripe Subscription fixture. */
function makeSubscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_test_abc',
    status: 'trialing',
    customer: 'cus_test_123',
    trial_end: Math.floor(Date.now() / 1000) + 14 * 86400,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    items: {
      data: [{ price: { id: 'price_squad_test' } }],
    },
    metadata: { tenantId: 'acme', userId: 'user_abc' },
    ...overrides,
  };
}

/** Minimal Stripe Invoice fixture. */
function makeInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'in_test_abc',
    amount_due: 4900,
    currency: 'usd',
    status: 'open',
    lines: {
      data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }],
    },
    metadata: { tenantId: 'acme' },
    ...overrides,
  };
}

describe('POST /api/billing/webhook — customer.subscription.created', () => {
  it('patches tenant CR billing status on subscription.created', async () => {
    const subscription = makeSubscription();
    const event = makeEvent('customer.subscription.created', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(subscription)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [slug, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    expect(slug).toBe('acme');
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.subscriptionId).toBe('sub_test_abc');
    expect(billing?.customerId).toBe('cus_test_123');
    expect(billing?.status).toBe('trialing');
  });

  it('emits billing.checkout_completed audit event', async () => {
    const subscription = makeSubscription();
    const event = makeEvent('customer.subscription.created', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    await POST(makeRequest(JSON.stringify(subscription)));

    const auditEvt = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).action === 'billing.checkout_completed',
    );
    expect(auditEvt).toBeDefined();
    expect(auditEvt!.targetTenant).toBe('acme');
  });

  it('returns 200 and skips when tenantId metadata is missing', async () => {
    const subscription = makeSubscription({ metadata: {} });
    const event = makeEvent('customer.subscription.created', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(subscription)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/webhook — customer.subscription.updated', () => {
  it('patches tenant CR billing status on subscription.updated', async () => {
    const subscription = makeSubscription({ status: 'active' });
    const event = {
      id: 'evt_updated',
      type: 'customer.subscription.updated',
      data: {
        object: subscription,
        previous_attributes: {},
      },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(subscription)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.status).toBe('active');
  });

  it('sends plan-changed email when priceId changed (with ownerEmail)', async () => {
    const subscription = makeSubscription({
      status: 'active',
      metadata: { tenantId: 'acme', userId: 'user_abc', ownerEmail: 'owner@example.com' },
    });
    const event = {
      id: 'evt_plan_change',
      type: 'customer.subscription.updated',
      data: {
        object: subscription,
        previous_attributes: {
          items: { data: [{ price: { id: 'price_old_tier' } }] },
        },
      },
    };
    mockVerifyWebhookSignature.mockReturnValue(event);

    await POST(makeRequest(JSON.stringify(subscription)));

    // Email sent because price changed (old vs new) and ownerEmail is present
    expect(mockEmailSend).toHaveBeenCalled();
  });
});

describe('POST /api/billing/webhook — customer.subscription.deleted', () => {
  it('sets billing status to cancelled and writes teardown-after annotation', async () => {
    const subscription = makeSubscription({ status: 'canceled' });
    const event = makeEvent('customer.subscription.deleted', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(subscription)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.status).toBe('cancelled');
    const annotations = (patch as { metadata?: { annotations?: Record<string, string> } }).metadata?.annotations;
    expect(annotations?.['gibson.zeroroot.ai/teardown-after']).toBeDefined();
  });

  it('emits billing.subscription_cancelled audit event', async () => {
    const subscription = makeSubscription({ status: 'canceled' });
    const event = makeEvent('customer.subscription.deleted', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    await POST(makeRequest(JSON.stringify(subscription)));

    const auditEvt = auditEvents.find(
      (e): e is Record<string, unknown> =>
        typeof e === 'object' && e !== null && (e as Record<string, unknown>).action === 'billing.subscription_cancelled',
    );
    expect(auditEvt).toBeDefined();
  });
});

describe('POST /api/billing/webhook — customer.subscription.trial_will_end', () => {
  it('sets trialEndsSoon = true on the Tenant CR', async () => {
    const subscription = makeSubscription();
    const event = makeEvent('customer.subscription.trial_will_end', subscription);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(subscription)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.trialEndsSoon).toBe(true);
  });
});

describe('POST /api/billing/webhook — invoice.paid', () => {
  it('sets status to active and clears pastDueSince', async () => {
    const invoice = makeInvoice();
    const event = makeEvent('invoice.paid', invoice);
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest(JSON.stringify(invoice)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.status).toBe('active');
    expect(billing?.pastDueSince).toBeNull();
    expect(billing?.trialEndsSoon).toBe(false);
  });
});

describe('POST /api/billing/webhook — invoice.payment_failed', () => {
  it('sets status to past_due and writes pastDueSince', async () => {
    const invoice = makeInvoice();
    const event = makeEvent('invoice.payment_failed', invoice);
    mockVerifyWebhookSignature.mockReturnValue(event);
    // First call is from handleInvoicePaymentFailed reading current tenant
    mockGetTenant.mockResolvedValue({
      ...healthyTenant(),
      status: { billing: { pastDueSince: undefined } },
    });

    const res = await POST(makeRequest(JSON.stringify(invoice)));

    expect(res.status).toBe(200);
    expect(mockPatchTenant).toHaveBeenCalledOnce();
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.status).toBe('past_due');
    expect(billing?.pastDueSince).toBeTruthy(); // ISO timestamp
  });

  it('does NOT overwrite pastDueSince on replay (idempotency)', async () => {
    const invoice = makeInvoice();
    const event = makeEvent('invoice.payment_failed', invoice);
    const originalPastDueSince = '2026-05-01T00:00:00.000Z';

    // First delivery: simulate existing pastDueSince; isNew=true (default).
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue({
      ...healthyTenant(),
      status: { billing: { pastDueSince: originalPastDueSince } },
    });

    await POST(makeRequest(JSON.stringify(invoice)));

    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    // Should preserve the original pastDueSince, not overwrite with now
    expect(billing?.pastDueSince).toBe(originalPastDueSince);
  });
});

describe('POST /api/billing/webhook — invoice.payment_action_required', () => {
  it('handles the same as invoice.payment_failed (sets past_due)', async () => {
    const invoice = makeInvoice();
    const event = makeEvent('invoice.payment_action_required', invoice);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue({
      ...healthyTenant(),
      status: { billing: { pastDueSince: undefined } },
    });

    const res = await POST(makeRequest(JSON.stringify(invoice)));

    expect(res.status).toBe(200);
    const [, patch] = mockPatchTenant.mock.calls[0] as [string, Record<string, unknown>];
    const billing = (patch as { status?: { billing?: Record<string, unknown> } }).status?.billing;
    expect(billing?.status).toBe('past_due');
  });
});

describe('POST /api/billing/webhook — idempotency replay (all new event types)', () => {
  it('patchTenant is called exactly once even when same subscription.created event delivered twice', async () => {
    const subscription = makeSubscription();
    const event = makeEvent('customer.subscription.created', subscription);

    // First delivery — new event (isNew=true, default mock).
    mockVerifyWebhookSignature.mockReturnValue(event);
    await POST(makeRequest(JSON.stringify(subscription)));
    const countAfterFirst = mockPatchTenant.mock.calls.length;
    expect(countAfterFirst).toBeGreaterThanOrEqual(1);

    // Second delivery (same event ID) — duplicate (isNew=false).
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockRecordWebhookEvent.mockResolvedValueOnce({ isNew: false });
    await POST(makeRequest(JSON.stringify(subscription)));
    // patchTenant should NOT have been called again.
    const countAfterSecond = mockPatchTenant.mock.calls.length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
