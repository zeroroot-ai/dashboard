import type { EmailMessage } from '../types';

/**
 * Billing plan-changed notification.
 *
 * Sent when a subscription upgrade or downgrade is detected via the
 * `customer.subscription.updated` event and the price ID has changed.
 * Includes proration invoice link when available.
 */
interface BillingPlanChangedCtx {
  /** Recipient email address. */
  email: string;
  /** Human-readable name of the old plan (e.g. "Squad"). */
  oldTierName: string;
  /** Human-readable name of the new plan (e.g. "Org"). */
  newTierName: string;
  /** URL to the Stripe proration invoice (optional, may be undefined). */
  prorationInvoiceUrl?: string;
  /** Human-readable new monthly amount (e.g. "$199/month"). */
  newMonthlyAmount: string;
  /** Human-readable effective date of the change (e.g. "May 10, 2026"). */
  effectiveDate: string;
  /** Support email address. */
  supportEmail: string;
}

export function render(ctx: BillingPlanChangedCtx): EmailMessage {
  const subject = `Your Gibson plan has been updated to ${ctx.newTierName}`;

  const text = [
    `Hi,`,
    ``,
    `Your Gibson plan has been updated from ${ctx.oldTierName} to ${ctx.newTierName}, effective ${ctx.effectiveDate}.`,
    ``,
    `New monthly amount: ${ctx.newMonthlyAmount}`,
    ``,
    ctx.prorationInvoiceUrl
      ? `A proration invoice has been generated for the plan change: ${ctx.prorationInvoiceUrl}`
      : '',
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
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Plan updated to ${escapeHtml(ctx.newTierName)}</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Your Gibson plan has been updated from <strong style="color:#ffffff;">${escapeHtml(ctx.oldTierName)}</strong> to <strong style="color:#ffffff;">${escapeHtml(ctx.newTierName)}</strong>, effective ${escapeHtml(ctx.effectiveDate)}.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background:#1e1e2a;border-radius:6px;padding:16px;margin:0 0 16px;width:100%;">`,
    `<tr><td style="font-size:13px;color:#9999a3;padding-bottom:8px;">New plan</td><td style="font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(ctx.newTierName)}</td></tr>`,
    `<tr><td style="font-size:13px;color:#9999a3;">New monthly amount</td><td style="font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(ctx.newMonthlyAmount)}</td></tr>`,
    `<tr><td style="font-size:13px;color:#9999a3;">Effective date</td><td style="font-size:13px;color:#ffffff;text-align:right;">${escapeHtml(ctx.effectiveDate)}</td></tr>`,
    `</table>`,
    ctx.prorationInvoiceUrl
      ? `<p style="margin:0 0 16px;font-size:13px;color:#9999a3;">A proration invoice has been generated for this change. <a href="${escapeAttr(ctx.prorationInvoiceUrl)}" style="color:#c5c5cc;text-decoration:underline;">View invoice</a>.</p>`
      : '',
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
