/**
 * @vitest-environment node
 *
 * Tests for confirmCardAndSubscribe — the deferred-mode inline card flow
 * (card-first signup redesign, dashboard#784/#785): fetch SetupIntent client
 * secret → confirmSetup → create subscription.
 */
import { describe, it, expect, vi } from 'vitest';
import { confirmCardAndSubscribe, type ConfirmCardStripe } from '../confirm-card';

function stripeStub(
  result: Awaited<ReturnType<ConfirmCardStripe['confirmSetup']>>,
): ConfirmCardStripe {
  return { confirmSetup: vi.fn().mockResolvedValue(result) };
}

/**
 * Routes by URL so the two server calls (setup-intent, subscription) can return
 * different statuses/bodies. setup-intent defaults to a valid client secret.
 */
function routedFetch(routes: {
  setupIntent?: { status: number; body?: unknown };
  subscription?: { status: number; body?: unknown };
}): typeof fetch {
  const si = routes.setupIntent ?? { status: 200, body: { clientSecret: 'seti_secret' } };
  const sub = routes.subscription ?? { status: 200, body: { subscriptionId: 'sub_1' } };
  return vi.fn().mockImplementation((url: string) => {
    const r = url.includes('setup-intent') ? si : sub;
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body ?? {}),
    });
  }) as unknown as typeof fetch;
}

const noSleep = async () => {};
const okSetup = { setupIntent: { status: 'succeeded', payment_method: 'pm_1' } };

function callBodies(fetchFn: typeof fetch) {
  return (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
    ([url, init]) => ({ url: url as string, body: JSON.parse((init as RequestInit).body as string) }),
  );
}

describe('confirmCardAndSubscribe (deferred)', () => {
  it('fetches a SetupIntent, confirms the card, then creates the subscription', async () => {
    const fetchFn = routedFetch({});
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
      sleepFn: noSleep,
    });
    expect(r).toEqual({ ok: true, subscriptionId: 'sub_1' });
    const calls = callBodies(fetchFn);
    expect(calls[0].url).toContain('/api/billing/setup-intent');
    expect(calls[1].url).toContain('/api/billing/subscription');
    expect(calls[1].body).toEqual({ tenantSlug: 'acme', tier: 'team', paymentMethodId: 'pm_1' });
  });

  it('extracts the payment method id from an expanded object', async () => {
    const fetchFn = routedFetch({});
    await confirmCardAndSubscribe({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: { id: 'pm_obj' } } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
      sleepFn: noSleep,
    });
    expect(callBodies(fetchFn)[1].body.paymentMethodId).toBe('pm_obj');
  });

  it('passes the fetched client secret to confirmSetup', async () => {
    const stripe = stripeStub(okSetup);
    await confirmCardAndSubscribe({
      stripe,
      elements: { marker: true },
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: routedFetch({ setupIntent: { status: 200, body: { clientSecret: 'seti_xyz' } } }),
      sleepFn: noSleep,
    });
    expect(stripe.confirmSetup).toHaveBeenCalledWith(
      expect.objectContaining({ clientSecret: 'seti_xyz', redirect: 'if_required' }),
    );
  });

  it('returns a retryable error on card decline (confirmSetup error)', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub({ error: { message: 'Your card was declined.' } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: routedFetch({}),
      sleepFn: noSleep,
    });
    expect(r).toEqual({ ok: false, error: 'Your card was declined.', retryable: true });
  });

  it('does NOT create a subscription when the card failed', async () => {
    const fetchFn = routedFetch({});
    await confirmCardAndSubscribe({
      stripe: stripeStub({ error: { message: 'declined' } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn,
      sleepFn: noSleep,
    });
    const calls = callBodies(fetchFn);
    // setup-intent was fetched, but the subscription endpoint was NOT hit.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/api/billing/setup-intent');
  });

  it('retries setup-intent 409 (customer not ready) then returns retryable on timeout', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: routedFetch({ setupIntent: { status: 409 } }),
      sleepFn: noSleep,
    });
    expect(r).toMatchObject({ ok: false, retryable: true });
  });

  it('treats a non-409 subscription error as non-retryable', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub(okSetup),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: routedFetch({ subscription: { status: 503 } }),
      sleepFn: noSleep,
    });
    expect(r).toMatchObject({ ok: false, retryable: false });
  });

  it('errors when confirmSetup succeeds without a payment method', async () => {
    const r = await confirmCardAndSubscribe({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: null } }),
      elements: {},
      tenantSlug: 'acme',
      tier: 'team',
      fetchFn: routedFetch({}),
      sleepFn: noSleep,
    });
    expect(r).toMatchObject({ ok: false });
  });
});
