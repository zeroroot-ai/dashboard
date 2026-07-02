import { describe, expect, it } from 'vitest';

import { render as renderCheckoutCompleted } from '../templates/billing-checkout-completed';
import { render as renderTrialWillEnd } from '../templates/billing-trial-will-end';
import { render as renderPaymentFailed } from '../templates/billing-payment-failed';
import { render as renderSubscriptionCancelled } from '../templates/billing-subscription-cancelled';
import { render as renderPlanChanged } from '../templates/billing-plan-changed';
import type { EmailMessage } from '../types';

/**
 * Deliverability guard, reject any template that references a remote image.
 */
const REMOTE_IMG_RE = /<img[^>]+src=["']?https?:/i;

/**
 * Plain-text must be a COMPLETE message, not a stub.
 */
const STUB_TEXT_RE = /see\s+(the\s+)?html\s+version|html\s+only/i;

function assertNoRemoteImages(html: string) {
  expect(html).not.toMatch(REMOTE_IMG_RE);
  expect(html).not.toMatch(/background(?:-image)?\s*:[^;]*url\(\s*['"]?https?:/i);
  expect(html).not.toMatch(/width=["']?1["']?\s+height=["']?1["']?/i);
}

function assertTextIsComplete(text: string, minLen = 80) {
  expect(text.length).toBeGreaterThanOrEqual(minLen);
  expect(text).not.toMatch(STUB_TEXT_RE);
}

function assertBasics(msg: EmailMessage) {
  expect(msg.to).toBeTruthy();
  expect(msg.subject).toBeTruthy();
  expect(msg.subject).not.toContain('\n');
  expect(msg.html).toContain('<html');
  assertNoRemoteImages(msg.html);
  assertTextIsComplete(msg.text);
}

// ---------------------------------------------------------------------------
// billing-checkout-completed
// ---------------------------------------------------------------------------

describe('templates/billing-checkout-completed', () => {
  const ctx = {
    email: 'alice@example.com',
    tierName: 'Squad',
    trialEndDate: '2026-05-24',
    dashboardUrl: 'https://app.zeroroot.ai/dashboard',
    portalUrl: 'https://billing.stripe.com/session/test_123',
    supportEmail: 'support@zeroroot.ai',
  };
  const msg = renderCheckoutCompleted(ctx);

  it('passes basic checks', () => {
    assertBasics(msg);
  });

  it('sets the correct recipient', () => {
    expect(msg.to).toBe('alice@example.com');
  });

  it('subject matches spec', () => {
    expect(msg.subject).toBe('Your Gibson trial has started, Squad plan');
  });

  it('HTML includes tier name', () => {
    expect(msg.html).toContain('Squad');
  });

  it('HTML includes trial end date', () => {
    expect(msg.html).toContain('2026-05-24');
  });

  it('HTML includes dashboard link', () => {
    expect(msg.html).toContain('https://app.zeroroot.ai/dashboard');
  });

  it('subject and html match snapshot', () => {
    expect(msg.subject).toMatchSnapshot();
    expect(msg.html).toMatchSnapshot();
    expect(msg.text).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// billing-trial-will-end
// ---------------------------------------------------------------------------

describe('templates/billing-trial-will-end', () => {
  const ctx = {
    email: 'bob@example.com',
    tierName: 'Org',
    daysRemaining: 3,
    firstChargeDate: 'May 24, 2026',
    firstChargeAmount: '$199/month',
    portalUrl: 'https://billing.stripe.com/session/test_456',
    pricingUrl: 'https://app.zeroroot.ai/pricing',
    supportEmail: 'support@zeroroot.ai',
  };
  const msg = renderTrialWillEnd(ctx);

  it('passes basic checks', () => {
    assertBasics(msg);
  });

  it('sets the correct recipient', () => {
    expect(msg.to).toBe('bob@example.com');
  });

  it('subject matches spec', () => {
    expect(msg.subject).toBe('Your Gibson trial ends in 3 days');
  });

  it('HTML includes days remaining', () => {
    expect(msg.html).toContain('3');
  });

  it('HTML includes charge amount', () => {
    expect(msg.html).toContain('$199/month');
  });

  it('subject and html match snapshot', () => {
    expect(msg.subject).toMatchSnapshot();
    expect(msg.html).toMatchSnapshot();
    expect(msg.text).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// billing-payment-failed
// ---------------------------------------------------------------------------

describe('templates/billing-payment-failed', () => {
  const ctx = {
    email: 'carol@example.com',
    chargeAmount: 4900,
    currency: 'USD',
    failureReason: 'insufficient_funds',
    portalUrl: 'https://billing.stripe.com/session/test_789',
    nextRetryDate: 'May 15, 2026',
    supportEmail: 'support@zeroroot.ai',
  };
  const msg = renderPaymentFailed(ctx);

  it('passes basic checks', () => {
    assertBasics(msg);
  });

  it('sets the correct recipient', () => {
    expect(msg.to).toBe('carol@example.com');
  });

  it('subject matches spec', () => {
    expect(msg.subject).toBe(
      'Action required: payment failed for your Gibson subscription',
    );
  });

  it('HTML includes formatted amount', () => {
    expect(msg.html).toContain('49.00 USD');
  });

  it('HTML includes failure reason', () => {
    expect(msg.html).toContain('insufficient_funds');
  });

  it('HTML includes next retry date', () => {
    expect(msg.html).toContain('May 15, 2026');
  });

  it('works without optional fields', () => {
    const minCtx = {
      email: 'carol@example.com',
      chargeAmount: 4900,
      currency: 'USD',
      portalUrl: 'https://billing.stripe.com/session/test_789',
      supportEmail: 'support@zeroroot.ai',
    };
    const minMsg = renderPaymentFailed(minCtx);
    assertBasics(minMsg);
  });

  it('subject and html match snapshot', () => {
    expect(msg.subject).toMatchSnapshot();
    expect(msg.html).toMatchSnapshot();
    expect(msg.text).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// billing-subscription-cancelled
// ---------------------------------------------------------------------------

describe('templates/billing-subscription-cancelled', () => {
  const ctx = {
    email: 'dave@example.com',
    gracePeriodEndDate: 'May 31, 2026',
    pricingUrl: 'https://app.zeroroot.ai/pricing',
    supportEmail: 'support@zeroroot.ai',
  };
  const msg = renderSubscriptionCancelled(ctx);

  it('passes basic checks', () => {
    assertBasics(msg);
  });

  it('sets the correct recipient', () => {
    expect(msg.to).toBe('dave@example.com');
  });

  it('subject matches spec', () => {
    expect(msg.subject).toBe('Your Gibson subscription has been cancelled');
  });

  it('HTML includes grace period end date', () => {
    expect(msg.html).toContain('May 31, 2026');
  });

  it('HTML includes pricing link', () => {
    expect(msg.html).toContain('https://app.zeroroot.ai/pricing');
  });

  it('subject and html match snapshot', () => {
    expect(msg.subject).toMatchSnapshot();
    expect(msg.html).toMatchSnapshot();
    expect(msg.text).toMatchSnapshot();
  });
});

// ---------------------------------------------------------------------------
// billing-plan-changed
// ---------------------------------------------------------------------------

describe('templates/billing-plan-changed', () => {
  const ctx = {
    email: 'eve@example.com',
    oldTierName: 'Squad',
    newTierName: 'Org',
    prorationInvoiceUrl: 'https://invoice.stripe.com/i/test_proration',
    newMonthlyAmount: '$199/month',
    effectiveDate: 'May 10, 2026',
    supportEmail: 'support@zeroroot.ai',
  };
  const msg = renderPlanChanged(ctx);

  it('passes basic checks', () => {
    assertBasics(msg);
  });

  it('sets the correct recipient', () => {
    expect(msg.to).toBe('eve@example.com');
  });

  it('subject matches spec', () => {
    expect(msg.subject).toBe('Your Gibson plan has been updated to Org');
  });

  it('HTML includes old and new tier names', () => {
    expect(msg.html).toContain('Squad');
    expect(msg.html).toContain('Org');
  });

  it('HTML includes proration invoice link', () => {
    expect(msg.html).toContain('https://invoice.stripe.com/i/test_proration');
  });

  it('works without optional prorationInvoiceUrl', () => {
    const minCtx = {
      email: 'eve@example.com',
      oldTierName: 'Squad',
      newTierName: 'Org',
      newMonthlyAmount: '$199/month',
      effectiveDate: 'May 10, 2026',
      supportEmail: 'support@zeroroot.ai',
    };
    const minMsg = renderPlanChanged(minCtx);
    assertBasics(minMsg);
  });

  it('subject and html match snapshot', () => {
    expect(msg.subject).toMatchSnapshot();
    expect(msg.html).toMatchSnapshot();
    expect(msg.text).toMatchSnapshot();
  });
});
