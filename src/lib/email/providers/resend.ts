import type { EmailMessage, EmailProvider } from '../types';

/**
 * Resend provider, wraps the `resend` SDK.
 *
 * The SDK is loaded lazily via dynamic `import()`; installs using the
 * `log` or `smtp` providers never bundle it.
 *
 * Configuration:
 *   DASHBOARD_EMAIL_RESEND_API_KEY, Resend API key (required)
 *   DASHBOARD_EMAIL_RESEND_FROM   , default From: address (required)
 */
export class ResendEmailProvider implements EmailProvider {
  private readonly apiKey: string;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.DASHBOARD_EMAIL_RESEND_API_KEY;
    const from = process.env.DASHBOARD_EMAIL_RESEND_FROM;

    if (!apiKey || !from) {
      throw new Error(
        'Resend provider missing required env: DASHBOARD_EMAIL_RESEND_API_KEY, DASHBOARD_EMAIL_RESEND_FROM',
      );
    }

    this.apiKey = apiKey;
    this.from = from;
  }

  async send(msg: EmailMessage): Promise<void> {
    // Dynamic import, SDK stays out of non-resend bundles.
    const mod = await import('resend');
    const Resend = (mod as { Resend?: typeof mod.Resend }).Resend ?? mod.Resend;

    const client = new Resend(this.apiKey);

    const result = await client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
    });

    // Resend returns an { data, error } shape, surface errors to the
    // caller instead of swallowing. Callers own retry behaviour.
    const err = (result as { error?: { message?: string; name?: string } }).error;
    if (err) {
      throw new Error(
        `Resend dispatch failed: ${err.name ?? 'error'}: ${err.message ?? 'unknown'}`,
      );
    }
  }
}
