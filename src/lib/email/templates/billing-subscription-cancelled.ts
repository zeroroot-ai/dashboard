import type { EmailMessage } from '../types';

/**
 * Billing subscription-cancelled notification.
 *
 * Sent when Stripe fires `customer.subscription.deleted`. Informs the customer
 * that their subscription has been cancelled, when their data will be retained
 * until, and how to reactivate.
 */
export interface BillingSubscriptionCancelledCtx {
  /** Recipient email address. */
  email: string;
  /**
   * Human-readable date when the 7-day grace period ends and data may be
   * purged (e.g. "May 31, 2026").
   */
  gracePeriodEndDate: string;
  /** Full URL to the Gibson pricing page for reactivation. */
  pricingUrl: string;
  /** Support email address. */
  supportEmail: string;
}

export function render(ctx: BillingSubscriptionCancelledCtx): EmailMessage {
  const subject = 'Your Gibson subscription has been cancelled';

  const text = [
    `Hi,`,
    ``,
    `Your Gibson subscription has been cancelled. You'll continue to have access to your account until ${ctx.gracePeriodEndDate}.`,
    ``,
    `Data retention: your workspace data will be retained for 7 days after cancellation (until ${ctx.gracePeriodEndDate}). After that, data may be permanently deleted.`,
    ``,
    `Want to reactivate your subscription? You can do so at any time from our pricing page:`,
    `${ctx.pricingUrl}`,
    ``,
    `Questions? Contact ${ctx.supportEmail}.`,
    ``,
    `— The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Subscription cancelled</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Your Gibson subscription has been cancelled. You'll continue to have access to your account until <strong style="color:#ffffff;">${escapeHtml(ctx.gracePeriodEndDate)}</strong>.</p>`,
    `<div style="background:#1e1e2a;border-radius:6px;padding:16px;margin:0 0 16px;">`,
    `<p style="margin:0;font-size:13px;color:#9999a3;"><strong style="color:#fbbf24;">Data retention:</strong> Your workspace data will be retained for 7 days after cancellation (until ${escapeHtml(ctx.gracePeriodEndDate)}). After that, data may be permanently deleted.</p>`,
    `</div>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Want to reactivate? <a href="${escapeAttr(ctx.pricingUrl)}" style="color:#c5c5cc;text-decoration:underline;">View our plans</a> and start a new subscription at any time.</p>`,
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
