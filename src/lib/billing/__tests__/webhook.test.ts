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

// DB pool mock — tracks SQL calls without a real PG connection.
const dbQueries: Array<{ text: string; values?: unknown[] }> = [];
let dbInsertRowCount = 1; // 1 = new event; 0 = duplicate

vi.mock('@/src/lib/db', () => ({
  getPool: () => ({
    query: vi.fn().mockImplementation((text: string, values?: unknown[]) => {
      dbQueries.push({ text, values });
      // INSERT ON CONFLICT returns rowCount=1 for new, 0 for duplicate.
      if (/INSERT.*ON CONFLICT/i.test(text)) {
        return Promise.resolve({ rowCount: dbInsertRowCount });
      }
      // DELETE (idempotency rollback) and CREATE TABLE always succeed.
      return Promise.resolve({ rowCount: 1 });
    }),
  }),
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

// Stub billing-rollback template render (returns a minimal EmailMessage).
vi.mock('@/src/lib/email/templates/billing-rollback', () => ({
  render: vi.fn().mockReturnValue({
    to: 'user@example.com',
    subject: 'Charge reversed',
    text: 'refund text',
    html: '<p>refund</p>',
  }),
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
    spec: { tier: 'squad', owner: 'owner@example.com', displayName: 'ACME' },
    status: { conditions: [] },
  };
}

/** Tenant CR with Blocked=True — provisioning definitively failed. */
function blockedTenant() {
  return {
    metadata: { name: 'acme', annotations: {} },
    spec: { tier: 'squad', owner: 'owner@example.com', displayName: 'ACME' },
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
    spec: { tier: 'squad', owner: 'owner@example.com', displayName: 'ACME' },
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
  dbQueries.length = 0;
  auditEvents.length = 0;
  dbInsertRowCount = 1; // default: new event
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
          'gibson.zero-day.ai/billing-active': 'true',
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
    // Simulate duplicate: INSERT returns rowCount=0.
    dbInsertRowCount = 0;

    const res = await POST(makeRequest(JSON.stringify(session)));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);

    // No side effects should have fired.
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
    expect(mockPatchTenant).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('records event_id in the idempotency table on first receipt', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    mockGetTenant.mockResolvedValue(healthyTenant());
    dbInsertRowCount = 1;

    await POST(makeRequest(JSON.stringify(session)));

    const insertQuery = dbQueries.find(
      (q) => /INSERT.*ON CONFLICT/i.test(q.text),
    );
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.values).toContain(event.id);
  });

  it('removes the idempotency record when processing fails (allows retry)', async () => {
    const session = makeSession();
    const event = makeEvent('checkout.session.completed', session);
    mockVerifyWebhookSignature.mockReturnValue(event);
    // getTenant throws → processing fails → idempotency row should be deleted.
    mockGetTenant.mockRejectedValue(new Error('k8s transient'));
    dbInsertRowCount = 1;

    await POST(makeRequest(JSON.stringify(session)));

    const deleteQuery = dbQueries.find((q) => /DELETE.*WHERE event_id/i.test(q.text));
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.values).toContain(event.id);
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
  it('returns 200 and takes no action for unrecognised event types', async () => {
    const event = makeEvent('customer.subscription.deleted', {});
    mockVerifyWebhookSignature.mockReturnValue(event);

    const res = await POST(makeRequest('{}'));

    expect(res.status).toBe(200);
    expect(mockGetTenant).not.toHaveBeenCalled();
    expect(mockRefundCharge).not.toHaveBeenCalled();
  });
});
