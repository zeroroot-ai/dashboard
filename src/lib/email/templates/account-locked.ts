import type { EmailMessage } from '../types';

/** Account-locked notification (too many failed sign-in attempts). */
export interface AccountLockedCtx {
  email: string;
  /** When the lockout window ends — formatted as an ISO 8601 string. */
  lockoutEndsAt: Date | string;
  /** Reset-password URL the user can follow to regain access sooner. */
  resetUrl: string;
}

export function render(ctx: AccountLockedCtx): EmailMessage {
  const subject = 'Your Gibson account has been temporarily locked';
  const endsAt =
    typeof ctx.lockoutEndsAt === 'string' ? ctx.lockoutEndsAt : ctx.lockoutEndsAt.toISOString();

  const text = [
    `Hi,`,
    ``,
    `We detected several failed sign-in attempts for your Gibson account (${ctx.email}) and have temporarily locked it as a security precaution.`,
    ``,
    `The lockout will lift automatically at ${endsAt} (UTC). If that was you, please wait and try again then — or reset your password now to regain access immediately:`,
    ``,
    ctx.resetUrl,
    ``,
    `If you don't recognize this activity, reset your password immediately and review recent sign-in activity.`,
    ``,
    `— The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;border-left:4px solid #e11d48;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">Account temporarily locked</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">We detected several failed sign-in attempts for <strong style="color:#ffffff;">${escapeHtml(ctx.email)}</strong> and have temporarily locked the account as a security precaution.</p>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">The lockout will lift automatically at <strong style="color:#ffffff;">${escapeHtml(endsAt)}</strong> (UTC).</p>`,
    `<p style="margin:0 0 24px;"><a href="${escapeAttr(ctx.resetUrl)}" style="display:inline-block;padding:10px 16px;background:#6366f1;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Reset password now</a></p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">Or paste this link in your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:12px;color:#c5c5cc;word-break:break-all;">${escapeHtml(ctx.resetUrl)}</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">If you don't recognize this activity, reset your password and review recent sign-in activity immediately.</p>`,
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
