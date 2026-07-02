import type { EmailMessage } from '../types';

/**
 * Billing payment-failed notification.
 *
 * Sent when Stripe fires `invoice.payment_failed` or
 * `invoice.payment_action_required` (3DS flows). The portal URL covers both
 * cases: the customer can update their card or complete 3DS authentication.
 *
 * Service impact: the subscription enters past_due state. After 7 days in
 * past_due, paid capabilities are revoked (entitlements enforcement).
 */
interface BillingPaymentFailedCtx {
  /** Recipient email address. */
  email: string;
  /** Failed charge amount in the smallest currency unit (e.g. cents). */
  chargeAmount: number;
  /** ISO 4217 currency code, upper-case (e.g. "USD"). */
  currency: string;
  /** Stripe's failure reason string (optional, may be undefined). */
  failureReason?: string;
  /** Full URL to the Stripe Customer Portal. */
  portalUrl: string;
  /** Human-readable date of the next retry (optional). */
  nextRetryDate?: string;
  /** Support email address. */
  supportEmail: string;
}

export function render(ctx: BillingPaymentFailedCtx): EmailMessage {
  const subject = 'Action required: payment failed for your Gibson subscription';
  const formatted = formatAmount(ctx.chargeAmount, ctx.currency);

  const text = [
    `Hi,`,
    ``,
    `A payment of ${formatted} for your Gibson subscription failed${ctx.failureReason ? ` (${ctx.failureReason})` : ''}.`,
    ``,
    `To keep your subscription active, please update your payment method in the billing portal:`,
    `${ctx.portalUrl}`,
    ``,
    ctx.nextRetryDate
      ? `Stripe will retry the payment automatically on ${ctx.nextRetryDate}.`
      : ``,
    ``,
    `Important: if the payment is not resolved within 7 days, your subscription will be moved to read-only mode and paid features will be restricted.`,
    ``,
    `Questions? Contact ${ctx.supportEmail}.`,
    ``,
    `The Gibson team`,
  ].filter((line) => line !== undefined).join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<div style="background:#7f1d1d;border-radius:6px;padding:12px 16px;margin:0 0 20px;">`,
    `<p style="margin:0;font-size:14px;font-weight:600;color:#fca5a5;">Action required: payment failed</p>`,
    `</div>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">A payment of <strong style="color:#ffffff;">${escapeHtml(formatted)}</strong> for your Gibson subscription failed${ctx.failureReason ? `, ${escapeHtml(ctx.failureReason)}` : ''}.`,
    `</p>`,
    `<p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#c5c5cc;">`,
    `<a href="${escapeAttr(ctx.portalUrl)}" style="display:inline-block;padding:10px 20px;background:#dc2626;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Update payment method</a>`,
    `</p>`,
    ctx.nextRetryDate
      ? `<p style="margin:0 0 16px;font-size:13px;color:#9999a3;">Stripe will retry the payment automatically on ${escapeHtml(ctx.nextRetryDate)}.</p>`
      : '',
    `<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#9999a3;border-top:1px solid #2a2a35;padding-top:16px;"><strong style="color:#fbbf24;">Important:</strong> if the payment is not resolved within 7 days, your subscription will be moved to read-only mode and paid features will be restricted.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">Questions? Contact <a href="mailto:${escapeAttr(ctx.supportEmail)}" style="color:#c5c5cc;text-decoration:underline;">${escapeHtml(ctx.supportEmail)}</a>.</p>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('');

  return { to: ctx.email, subject, text, html };
}

function formatAmount(minorUnits: number, currency: string): string {
  const major = (minorUnits / 100).toFixed(2);
  return `${major} ${currency.toUpperCase()}`;
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
