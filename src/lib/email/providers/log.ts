import type { EmailMessage, EmailProvider } from '../types';

/**
 * Log provider — the default when `DASHBOARD_EMAIL_PROVIDER` is unset.
 *
 * Writes a single JSON line to stdout with ONLY routing metadata (`to`,
 * `subject`). The body is intentionally omitted so that token URLs,
 * one-time codes, and any templated PII never land in shared log sinks
 * (Loki / stdout scrapers / k8s events).
 *
 * Useful for:
 *   - local kind clusters where SMTP / Resend aren't configured
 *   - CI environments where we just want to observe that mail would go
 *   - failure modes where we want a side-effect-free fallback
 */
export class LogEmailProvider implements EmailProvider {
  async send(msg: EmailMessage): Promise<void> {
    // Keep the payload minimal — anything we print here is shipped to
    // shared logging infrastructure.
    const line = JSON.stringify({ to: msg.to, subject: msg.subject });
    // eslint-disable-next-line no-console
    console.log(`[email.log] ${line}`);
  }
}
