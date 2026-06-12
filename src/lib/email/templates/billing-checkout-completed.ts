import type { EmailMessage } from '../types';

/**
 * Billing checkout-completed notification.
 *
 * Sent when a customer completes the Stripe Checkout flow and their 14-day
 * trial has started. Confirms that a payment method has been collected and
 * provides links to the dashboard and the Stripe Customer Portal.
 */
export interface BillingCheckoutCompletedCtx {
  /** Recipient email address. */
  email: string;
  /** Human-readable plan name (e.g. "Squad", "Org", "Platform"). */
  tierName: string;
  /** ISO 8601 date string for trial end (e.g. "2026-05-24"). */
  trialEndDate: string;
  /** Full URL to the Gibson dashboard. */
  dashboardUrl: string;
  /** Full URL to the Stripe Customer Portal for this customer. */
  portalUrl: string;
  /** Support email address. */
  supportEmail: string;
}

export function render(ctx: BillingCheckoutCompletedCtx): EmailMessage {
  const subject = `Your Gibson trial has started, ${ctx.tierName} plan`;

  const text = [
    `Hi,`,
    ``,
    `Your Gibson ${ctx.tierName} trial has started. Your payment method has been confirmed and you won't be charged until your trial ends on ${ctx.trialEndDate}.`,
    ``,
    `Get started: ${ctx.dashboardUrl}`,
    ``,
    `Want to update your payment method or review your subscription? Visit the billing portal:`,
    `${ctx.portalUrl}`,
    ``,
    `Your trial runs until ${ctx.trialEndDate}. After that, your card will be charged automatically. You can cancel at any time before the trial ends with no charge.`,
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
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Your Gibson trial has started</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">You're now on the <strong style="color:#ffffff;">${escapeHtml(ctx.tierName)}</strong> plan. Your payment method has been confirmed and you won't be charged until your trial ends on <strong style="color:#ffffff;">${escapeHtml(ctx.trialEndDate)}</strong>.</p>`,
    `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#c5c5cc;">`,
    `<a href="${escapeAttr(ctx.dashboardUrl)}" style="display:inline-block;padding:10px 20px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Go to Dashboard</a>`,
    `</p>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Need to update your payment method or review your subscription? <a href="${escapeAttr(ctx.portalUrl)}" style="color:#c5c5cc;text-decoration:underline;">Visit the billing portal</a>.</p>`,
    `<p style="margin:0 0 16px;font-size:12px;line-height:1.5;color:#9999a3;">You can cancel at any time before ${escapeHtml(ctx.trialEndDate)} with no charge. After the trial, your card will be billed automatically.</p>`,
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
