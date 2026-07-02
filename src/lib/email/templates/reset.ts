import type { EmailMessage } from '../types';

/** Password-reset request. */
interface ResetCtx {
  email: string;
  resetUrl: string;
  expiresInHours: number;
}

export function render(ctx: ResetCtx): EmailMessage {
  const subject = 'Reset your Gibson password';

  const text = [
    `Hi,`,
    ``,
    `We received a request to reset the password for your Gibson account (${ctx.email}). Open the link below to choose a new password:`,
    ``,
    ctx.resetUrl,
    ``,
    `This link expires in ${ctx.expiresInHours} hour${ctx.expiresInHours === 1 ? '' : 's'}.`,
    ``,
    `If you did NOT request a password reset, you can ignore this email, your current password remains active. For added safety, consider reviewing your recent sign-in activity.`,
    ``,
    `The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Reset your password</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">We received a request to reset the password for <strong style="color:#ffffff;">${escapeHtml(ctx.email)}</strong>.</p>`,
    `<p style="margin:0 0 24px;"><a href="${escapeAttr(ctx.resetUrl)}" style="display:inline-block;padding:10px 16px;background:#6366f1;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Choose a new password</a></p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">Or paste this link in your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:12px;color:#c5c5cc;word-break:break-all;">${escapeHtml(ctx.resetUrl)}</p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">This link expires in ${ctx.expiresInHours} hour${ctx.expiresInHours === 1 ? '' : 's'}.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">If you didn't request this, you can ignore the email, your current password remains active.</p>`,
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
