import type { EmailMessage, EmailProvider } from '../types';

/**
 * SMTP provider — wraps `nodemailer`.
 *
 * The nodemailer SDK is loaded lazily via dynamic `import()` so that
 * installs running with `DASHBOARD_EMAIL_PROVIDER=log` (or unset) don't
 * pay the bundle / cold-start cost.
 *
 * Configuration (all read at construction time):
 *   DASHBOARD_EMAIL_SMTP_HOST   — SMTP host (required)
 *   DASHBOARD_EMAIL_SMTP_PORT   — SMTP port (required, numeric)
 *   DASHBOARD_EMAIL_SMTP_USER   — auth user (required)
 *   DASHBOARD_EMAIL_SMTP_PASS   — auth pass (required)
 *   DASHBOARD_EMAIL_SMTP_FROM   — default From: header (required)
 */
export class SmtpEmailProvider implements EmailProvider {
  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly pass: string;
  private readonly from: string;

  constructor() {
    const host = process.env.DASHBOARD_EMAIL_SMTP_HOST;
    const portStr = process.env.DASHBOARD_EMAIL_SMTP_PORT;
    const user = process.env.DASHBOARD_EMAIL_SMTP_USER;
    const pass = process.env.DASHBOARD_EMAIL_SMTP_PASS;
    const from = process.env.DASHBOARD_EMAIL_SMTP_FROM;

    if (!host || !portStr || !user || !pass || !from) {
      throw new Error(
        'SMTP provider missing required env: DASHBOARD_EMAIL_SMTP_HOST, _PORT, _USER, _PASS, _FROM',
      );
    }

    const port = Number(portStr);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      throw new Error(
        `SMTP provider: DASHBOARD_EMAIL_SMTP_PORT must be a valid port number (got ${portStr})`,
      );
    }

    this.host = host;
    this.port = port;
    this.user = user;
    this.pass = pass;
    this.from = from;
  }

  async send(msg: EmailMessage): Promise<void> {
    // Dynamic import keeps nodemailer out of the bundle for non-smtp
    // deployments. Errors from the transport propagate to the caller —
    // dispatch errors are NOT swallowed (callers pick retry strategy).
    const mod = await import('nodemailer');
    const nodemailer = ((mod as unknown) as { default?: typeof mod }).default ?? mod;

    const transporter = nodemailer.createTransport({
      host: this.host,
      port: this.port,
      secure: this.port === 465,
      auth: { user: this.user, pass: this.pass },
    });

    await transporter.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
    });
  }
}
