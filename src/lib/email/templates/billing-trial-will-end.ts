import type { EmailMessage } from '../types';

/**
 * Billing trial-will-end notification.
 *
 * Sent when Stripe fires the `customer.subscription.trial_will_end` event
 * (3 days before the trial ends). Encourages the customer to confirm their
 * payment method and provides a clear picture of what they'll be charged.
 */
export interface BillingTrialWillEndCtx {
  /** Recipient email address. */
  email: string;
  /** Human-readable plan name (e.g. "Squad", "Org", "Platform"). */
  tierName: string;
  /** Number of days remaining in the trial (typically 3). */
  daysRemaining: number;
  /** Human-readable date when the first charge will occur (e.g. "May 24, 2026"). */
  firstChargeDate: string;
  /** Human-readable charge amount (e.g. "$49/month"). */
  firstChargeAmount: string;
  /** Full URL to the Stripe Customer Portal to update card or cancel. */
  portalUrl: string;
  /** Full URL to the Gibson pricing page. */
  pricingUrl: string;
  /** Support email address. */
  supportEmail: string;
}

export function render(ctx: BillingTrialWillEndCtx): EmailMessage {
  const subject = `Your Gibson trial ends in ${ctx.daysRemaining} days`;

  const text = [
    `Hi,`,
    ``,
    `Your Gibson ${ctx.tierName} trial ends in ${ctx.daysRemaining} ${ctx.daysRemaining === 1 ? 'day' : 'days'}.`,
    ``,
    `Current plan: ${ctx.tierName}`,
    `First charge: ${ctx.firstChargeAmount} on ${ctx.firstChargeDate}`,
    ``,
    `To continue using Gibson, make sure your payment method is up to date. You can update your card or cancel in the billing portal:`,
    `${ctx.portalUrl}`,
    ``,
    `If you'd like to explore other plans, visit our pricing page:`,
    `${ctx.pricingUrl}`,
    ``,
    `If you cancel before ${ctx.firstChargeDate}, you won't be charged.`,
    ``,
    `Questions? Contact ${ctx.supportEmail}.`,
    ``,
    `The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Your trial ends in ${escapeHtml(String(ctx.daysRemaining))} ${ctx.daysRemaining === 1 ? 'day' : 'days'}</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Your <strong style="color:#ffffff;">${escapeHtml(ctx.tierName)}</strong> trial is ending soon.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#1e1e2a;border-radius:6px;padding:16px;margin:0 0 16px;width:100%;">`,
    `<tr><td style="font-size:13px;color:#9999a3;padding-bottom:8px;">Current plan</td><td style="font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(ctx.tierName)}</td></tr>`,
    `<tr><td style="font-size:13px;color:#9999a3;">First charge</td><td style="font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(ctx.firstChargeAmount)} on ${escapeHtml(ctx.firstChargeDate)}</td></tr>`,
    `</table>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Update your payment method or cancel in the billing portal:</p>`,
    `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#c5c5cc;">`,
    `<a href="${escapeAttr(ctx.portalUrl)}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Manage billing</a>`,
    `</p>`,
    `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#9999a3;">Want to explore other plans? <a href="${escapeAttr(ctx.pricingUrl)}" style="color:#c5c5cc;text-decoration:underline;">View pricing</a>.</p>`,
    `<p style="margin:0 0 16px;font-size:12px;color:#9999a3;">If you cancel before ${escapeHtml(ctx.firstChargeDate)}, you won't be charged.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">Questions? Contact <a href="mailto:${escapeAttr(ctx.supportEmail)}" style="color:#c5c5cc;text-decoration:underline;">${escapeHtml(ctx.supportEmail)}</a>.</p>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('');

  return { to: ctx.email, subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
