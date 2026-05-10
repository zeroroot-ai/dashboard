import type { EmailProvider } from './types';
import { LogEmailProvider } from './providers/log';
import { SmtpEmailProvider } from './providers/smtp';
import { ResendEmailProvider } from './providers/resend';
import { SesEmailProvider } from './providers/ses';

/**
 * Factory for the singleton email provider.
 *
 * Resolution order:
 *   - `DASHBOARD_EMAIL_PROVIDER=resend` → Resend SDK
 *   - `DASHBOARD_EMAIL_PROVIDER=smtp`   → nodemailer
 *   - `DASHBOARD_EMAIL_PROVIDER=log` (default) → stdout JSON line
 *
 * The provider *wrapper* classes are pulled in statically — they are
 * tiny pure-TS files. The heavy SDK dependencies (`nodemailer`,
 * `resend`) are still loaded via dynamic `import()` inside each
 * wrapper's `send()` method, so a deployment using the `log` provider
 * never resolves them at runtime.
 *
 * The result is cached per-process; callers can reset by passing
 * `{ force: true }` which is useful in tests.
 */
let cached: EmailProvider | null = null;

export function getEmailProvider(opts?: { force?: boolean }): EmailProvider {
  if (cached && !opts?.force) return cached;

  const choice = (process.env.DASHBOARD_EMAIL_PROVIDER ?? 'log').toLowerCase();

  switch (choice) {
    case 'resend':
      cached = new ResendEmailProvider();
      return cached;
    case 'smtp':
      cached = new SmtpEmailProvider();
      return cached;
    case 'ses':
      cached = new SesEmailProvider();
      return cached;
    case 'log':
      cached = new LogEmailProvider();
      return cached;
    default:
      throw new Error(
        `Unknown DASHBOARD_EMAIL_PROVIDER value: ${choice} (expected resend|smtp|ses|log)`,
      );
  }
}

/** Test-only — clears the cached provider so env changes take effect. */
export function __resetEmailProviderForTests(): void {
  cached = null;
}
