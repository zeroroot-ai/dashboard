import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SesEmailProvider } from '../providers/ses';
import type { EmailMessage } from '../types';

// --- SDK mock ----------------------------------------------------------
//
// `@aws-sdk/client-ses` is loaded via dynamic require inside `send()`;
// mock it so tests assert on the exact SendEmailCommand input without
// the real SDK or AWS credentials.

const sesSend = vi.fn().mockResolvedValue({ MessageId: 'm1' });
const sendEmailCommand = vi.fn().mockImplementation(function SendEmailCommand(
  this: { input: unknown },
  input: unknown,
) {
  this.input = input;
});

vi.mock('@aws-sdk/client-ses', () => ({
  SESClient: vi.fn().mockImplementation(function SESClient() {
    return { send: sesSend };
  }),
  SendEmailCommand: sendEmailCommand,
}));

const REQUIRED_ENV = {
  SES_FROM_ADDRESS: 'no-reply@staging.zeroroot.ai',
  AWS_REGION: 'us-east-1',
  SES_CONFIGURATION_SET: 'gibson-transactional-staging',
} as const;

const msg: EmailMessage = {
  to: 'user@example.com',
  subject: 'subject',
  html: '<p>hi</p>',
  text: 'hi',
};

describe('SesEmailProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [k, v] of Object.entries(REQUIRED_ENV)) {
      vi.stubEnv(k, v);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(Object.keys(REQUIRED_ENV))(
    'throws at construction when %s is missing',
    (key) => {
      vi.stubEnv(key, '');
      expect(() => new SesEmailProvider()).toThrow(
        `SES provider missing required env: ${key}`,
      );
    },
  );

  it('stamps ConfigurationSetName from SES_CONFIGURATION_SET, never NODE_ENV', async () => {
    // NODE_ENV is "production" in EVERY prod-mode build — staging included —
    // so deriving the set name from it pointed staging at the nonexistent
    // gibson-transactional-production (deploy#880, 2026-06-12 outage).
    vi.stubEnv('NODE_ENV', 'production');

    await new SesEmailProvider().send(msg);

    expect(sendEmailCommand).toHaveBeenCalledTimes(1);
    const input = sendEmailCommand.mock.calls[0][0] as Record<string, unknown>;
    expect(input.ConfigurationSetName).toBe('gibson-transactional-staging');
    expect(input.Source).toBe(REQUIRED_ENV.SES_FROM_ADDRESS);
  });
});
