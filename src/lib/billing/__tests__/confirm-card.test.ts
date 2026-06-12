/**
 * @vitest-environment node
 *
 * Tests for confirmCardAndSubscribe (card-first signup S2, dashboard#769).
 */
import { describe, it, expect, vi } from 'vitest';
import { confirmCardAndSubscribe, type ConfirmCardStripe } from '../confirm-card';

function stripeStub(result: Awaited<ReturnType<ConfirmCardStripe['confirmSetup']>>): ConfirmCardStripe {
  return { confirmSetup: vi.fn().mockResolvedValue(result) };
}

function fetchStub(status: number, body: unknown = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

const okSetup = { setupIntent: { status: 'succeeded', payment_method: 'pm_1' } };

describe('confirmCardAndSubscribe', () => {
  it('confirms the card then creates the subscription, returning its id', async () => {
    const fetchFn = fetchStub(200, { subscriptionId: 'sub_1' });
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
    });
    expect(r).toEqual({ ok: true, subscriptionId: 'sub_1' });
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ tenantSlug: 'acme', tier: 'team', paymentMethodId: 'pm_1' });
  });

  it('extracts the payment method id from an expanded object', async () => {
    const fetchFn = fetchStub(200, { subscriptionId: 'sub_2' });
    await confirmCardAndSubscribe({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: { id: 'pm_obj' } } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
    });
    const [, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).paymentMethodId).toBe('pm_obj');
  });

  it('returns a retryable error on card decline (confirmSetup error)', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub({ error: { message: 'Your card was declined.' } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: fetchStub(200),
    });
    expect(r).toEqual({ ok: false, error: 'Your card was declined.', retryable: true });
  });

  it('does NOT create a subscription when the card failed', async () => {
    const fetchFn = fetchStub(200);
    await confirmCardAndSubscribe({
      stripe: stripeStub({ error: { message: 'declined' } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('treats a 409 (customer not ready) as retryable', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: fetchStub(409),
    });
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ retryable: true });
  });

  it('treats a non-409 server error as non-retryable', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: fetchStub(503),
    });
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it('errors when confirmSetup succeeds without a payment method', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: null } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: fetchStub(200),
    });
    expect(r).toMatchObject({ ok: false });
  });
});
