import type { EmailMessage } from '../types';

/** Organization invite / claim. */
interface ClaimCtx {
  email: string;
  claimUrl: string;
  expiresInDays: number;
  orgName: string;
  role: string;
  supportEmail: string;
}

export function render(ctx: ClaimCtx): EmailMessage {
  const subject = `You're invited to join ${ctx.orgName} on Gibson`;

  const text = [
    `Hi,`,
    ``,
    `You have been invited to join the organization "${ctx.orgName}" on Gibson as ${indefiniteArticle(ctx.role)} ${ctx.role}.`,
    ``,
    `Accept the invitation and set up your account by opening the link below:`,
    ``,
    ctx.claimUrl,
    ``,
    `This invitation expires in ${ctx.expiresInDays} day${ctx.expiresInDays === 1 ? '' : 's'}.`,
    ``,
    `If you weren't expecting this invitation or have questions, contact ${ctx.supportEmail}.`,
    ``,
    `The Gibson team`,
  ].join('\n');

  const html = [
    `<!doctype html>`,
    `<html lang="en">`,
    `<body style="margin:0;padding:24px;background:#0b0b0f;color:#e6e6ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;margin:0 auto;background:#15151c;border-radius:8px;padding:32px;">`,
    `<tr><td>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#ffffff;">You're invited to ${escapeHtml(ctx.orgName)}</h1>`,
    `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#c5c5cc;">You have been invited to join the organization <strong style="color:#ffffff;">${escapeHtml(ctx.orgName)}</strong> on Gibson as <strong style="color:#ffffff;">${escapeHtml(ctx.role)}</strong>.</p>`,
    `<p style="margin:0 0 24px;"><a href="${escapeAttr(ctx.claimUrl)}" style="display:inline-block;padding:10px 16px;background:#6366f1;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">Accept invitation</a></p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">Or paste this link in your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:12px;color:#c5c5cc;word-break:break-all;">${escapeHtml(ctx.claimUrl)}</p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#9999a3;">This invitation expires in ${ctx.expiresInDays} day${ctx.expiresInDays === 1 ? '' : 's'}.</p>`,
    `<p style="margin:0;font-size:12px;color:#9999a3;">If you weren't expecting this, contact <a href="mailto:${escapeAttr(ctx.supportEmail)}" style="color:#c5c5cc;text-decoration:underline;">${escapeHtml(ctx.supportEmail)}</a>.</p>`,
    `</td></tr>`,
    `</table>`,
    `</body>`,
    `</html>`,
  ].join('');

  return { to: ctx.email, subject, text, html };
}

function indefiniteArticle(word: string): string {
  return /^[aeiouAEIOU]/.test(word) ? 'an' : 'a';
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
