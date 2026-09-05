import type { EmailMessage } from '../types';

/**
 * Billing-rollback notification.
 *
 * Sent when a charge was rolled back after provisioning failed so the
 * user doesn't silently lose money. Contains enough detail for them to
 * reconcile against their card statement.
 */
interface BillingRollbackCtx {
  email: string;
  /** Charged amount, in the smallest currency unit (e.g. cents). */
  chargeAmount: number;
  /** ISO 4217 code, upper-case (e.g. `USD`, `EUR`). */
  currency: string;
  supportEmail: string;
}

export function render(ctx: BillingRollbackCtx): EmailMessage {
  const subject = 'Your Gibson charge was reversed';
  const formatted = formatAmount(ctx.chargeAmount, ctx.currency);

  const text = [
    `Hi,`,
    ``,
    `We reversed a recent charge of ${formatted} on the payment method associated with your Gibson account (${ctx.email}).`,
    ``,
    `This happened because we could not fully provision the resource you purchased. You have not been billed, and no further action is required on your part. The reversal may take several business days to appear on your card statement depending on your bank.`,
    ``,
    `If you have questions, or if the charge still appears on your statement after 7 business days, contact ${ctx.supportEmail}.`,
    ``,
    `The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Charge reversed</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">We reversed a recent charge of <strong style="color:#ffffff;">${escapeHtml(formatted)}</strong> on the payment method associated with <strong style="color:#ffffff;">${escapeHtml(ctx.email)}</strong>.</p>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">This happened because we could not fully provision the resource you purchased. You have <strong>not</strong> been billed and no further action is required on your part.</p>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">The reversal may take several business days to appear on your statement depending on your bank.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">Questions? Contact <a href="mailto:${escapeAttr(ctx.supportEmail)}" style="color:#c5c5cc;text-decoration:underline;">${escapeHtml(ctx.supportEmail)}</a>.</p>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('');

  return { to: ctx.email, subject, text, html };
}

/**
 * Format a minor-unit amount (cents) as a human string. We avoid the
 * Intl.NumberFormat currency formatter because it may insert non-ASCII
 * currency symbols that some email clients mangle, an ISO code plus a
 * decimal string is universally safe.
 */
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
