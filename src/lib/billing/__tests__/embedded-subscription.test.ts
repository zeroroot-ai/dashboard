/**
 * @vitest-environment node
 *
 * Tests for the embedded card-collection helpers (card-first-signup S2,
 * dashboard#769): createSetupIntent + createTrialingSubscription. The Stripe
 * SDK is mocked so we assert the exact parameters our code sends.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createSetupIntent,
  createTrialingSubscription,
  __resetStripeClientForTests,
  __setStripeClientForTests,
} from '../stripe';

const setupIntentsCreate = vi.fn();
const subscriptionsCreate = vi.fn();

beforeEach(() => {
  setupIntentsCreate.mockReset().mockResolvedValue({ id: 'seti_1', client_secret: 'seti_1_secret' });
  subscriptionsCreate.mockReset().mockResolvedValue({ id: 'sub_1', status: 'trialing' });
  __setStripeClientForTests({
    setupIntents: { create: setupIntentsCreate },
    subscriptions: { create: subscriptionsCreate },
  });
});

afterEach(() => {
  __resetStripeClientForTests();
});

describe('createSetupIntent', () => {
  it('creates an off_session SetupIntent bound to the customer with tenant metadata', async () => {
    await createSetupIntent({
      customerId: 'cus_123',
      tenantSlug: 'acme',
      idempotencyKey: 'idem-1',
    });
    expect(setupIntentsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = setupIntentsCreate.mock.calls[0];
    expect(params.customer).toBe('cus_123');
    expect(params.usage).toBe('off_session');
    expect(params.automatic_payment_methods).toEqual({ enabled: true });
    expect(params.metadata).toEqual({ tenantId: 'acme' });
    expect(opts).toEqual({ idempotencyKey: 'idem-1' });
  });
});

describe('createTrialingSubscription', () => {
  it('creates a trialing subscription with the confirmed card as default and a Radar trial marker', async () => {
    await createTrialingSubscription({
      tier: 'team',
      priceId: 'price_team',
      customerId: 'cus_123',
      paymentMethodId: 'pm_456',
      trialPeriodDays: 14,
      tenantSlug: 'acme',
      idempotencyKey: 'idem-sub-1',
    });
    expect(subscriptionsCreate).toHaveBeenCalledTimes(1);
    const [params, opts] = subscriptionsCreate.mock.calls[0];
    expect(params.customer).toBe('cus_123');
    expect(params.items).toEqual([{ price: 'price_team' }]);
    expect(params.trial_period_days).toBe(14);
    expect(params.default_payment_method).toBe('pm_456');
    expect(params.trial_settings.end_behavior.missing_payment_method).toBe('cancel');
    expect(params.metadata).toMatchObject({ tenantId: 'acme', tier: 'team', trial_signup: 'true' });
    expect(opts).toEqual({ idempotencyKey: 'idem-sub-1' });
  });

  it('uses the trial length passed from the plan registry, not a hardcoded constant', async () => {
    await createTrialingSubscription({
      tier: 'org',
      priceId: 'price_org',
      customerId: 'cus_9',
      paymentMethodId: 'pm_9',
      trialPeriodDays: 30,
      tenantSlug: 'beta',
      idempotencyKey: 'idem-sub-2',
    });
    expect(subscriptionsCreate.mock.calls[0][0].trial_period_days).toBe(30);
  });

  it('refuses contact-sales tiers', async () => {
    await expect(
      createTrialingSubscription({
        tier: 'enterprise-deploy' as 'team',
        priceId: 'price_x',
        customerId: 'cus_x',
        paymentMethodId: 'pm_x',
        trialPeriodDays: 14,
        tenantSlug: 'x',
        idempotencyKey: 'idem-x',
      }),
    ).rejects.toThrow('contact-sales');
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });
});
