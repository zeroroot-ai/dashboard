/**
 * @vitest-environment node
 *
 * Tests for confirmCardSetup — the client-side card confirmation step of the
 * inline card-first signup (dashboard#785). It confirms the phase-1 SetupIntent
 * against the deferred Payment Element and returns the payment method id;
 * subscription + account creation happen server-side in completeSignup().
 */
import { describe, it, expect, vi } from 'vitest';
import { confirmCardSetup, type ConfirmCardStripe } from '../confirm-card';

function stripeStub(
  result: Awaited<ReturnType<ConfirmCardStripe['confirmSetup']>>,
): ConfirmCardStripe {
  return { confirmSetup: vi.fn().mockResolvedValue(result) };
}

const okSetup = { setupIntent: { status: 'succeeded', payment_method: 'pm_1' } };

describe('confirmCardSetup', () => {
  it('confirms the card and returns the payment method id', async () => {
    const r = await confirmCardSetup({
      stripe: stripeStub(okSetup),
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toEqual({ ok: true, paymentMethodId: 'pm_1' });
  });

  it('extracts the payment method id from an expanded object', async () => {
    const r = await confirmCardSetup({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: { id: 'pm_obj' } } }),
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toEqual({ ok: true, paymentMethodId: 'pm_obj' });
  });

  it('passes the client secret, return_url and redirect mode to confirmSetup', async () => {
    const stripe = stripeStub(okSetup);
    await confirmCardSetup({
      stripe,
      elements: { marker: true },
      clientSecret: 'seti_xyz',
      returnUrl: 'https://app.test/signup',
    });
    expect(stripe.confirmSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        clientSecret: 'seti_xyz',
        redirect: 'if_required',
        confirmParams: { return_url: 'https://app.test/signup' },
      }),
    );
  });

  it('returns an error on card decline (confirmSetup error)', async () => {
    const r = await confirmCardSetup({
      stripe: stripeStub({ error: { message: 'Your card was declined.' } }),
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toEqual({ ok: false, error: 'Your card was declined.' });
  });

  it('surfaces the real message when confirmSetup throws (integration error)', async () => {
    const stripe: ConfirmCardStripe = {
      confirmSetup: vi.fn().mockRejectedValue(new Error('elements should have a mounted Payment Element')),
    };
    const r = await confirmCardSetup({
      stripe,
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toEqual({ ok: false, error: 'elements should have a mounted Payment Element' });
  });

  it('errors when the SetupIntent did not reach succeeded', async () => {
    const r = await confirmCardSetup({
      stripe: stripeStub({ setupIntent: { status: 'requires_action', payment_method: 'pm_1' } }),
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toMatchObject({ ok: false });
  });

  it('errors when confirmSetup succeeds without a payment method', async () => {
    const r = await confirmCardSetup({
      stripe: stripeStub({ setupIntent: { status: 'succeeded', payment_method: null } }),
      elements: {},
      clientSecret: 'seti_secret',
      returnUrl: 'https://app.test/signup',
    });
    expect(r).toMatchObject({ ok: false });
  });
});
