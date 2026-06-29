import type { EmailMessage } from '../types';

/**
 * `verify`, sent on sign-up to confirm an email address belongs to the
 * user who supplied it. Links expire (`expiresInHours`).
 */
interface VerifyCtx {
  email: string;
  verificationUrl: string;
  expiresInHours: number;
}

/** Render the "verify your email" transactional message. */
export function render(ctx: VerifyCtx): EmailMessage {
  const subject = 'Verify your email address';

  const text = [
    `Hi,`,
    ``,
    `Please verify the email address (${ctx.email}) you used to sign up for Gibson by opening the link below:`,
    ``,
    ctx.verificationUrl,
    ``,
    `This link expires in ${ctx.expiresInHours} hour${ctx.expiresInHours === 1 ? '' : 's'}.`,
    ``,
    `If you didn't create a Gibson account, you can ignore this message, no account will be created without verification.`,
    ``,
    `The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Verify your email address</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">Please verify the email address <strong style="color:#ffffff;">${escapeHtml(ctx.email)}</strong> you used to sign up for Gibson.</p>`,
    `<p style="margin:0 0 24px;"><a href="${escapeAttr(ctx.verificationUrl)}" style="display:inline-block;padding:10px 16px;background:#6366f1;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Verify email</a></p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">Or paste this link in your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:12px;color:#c5c5cc;word-break:break-all;">${escapeHtml(ctx.verificationUrl)}</p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">This link expires in ${ctx.expiresInHours} hour${ctx.expiresInHours === 1 ? '' : 's'}.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">If you didn't create a Gibson account you can ignore this message, no account will be created without verification.</p>`,
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
