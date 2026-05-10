import type { EmailMessage, EmailProvider } from '../types';

/**
 * Amazon SES v3 email provider.
 *
 * Sends transactional email via `@aws-sdk/client-ses` v3 `SendEmailCommand`.
 * Credentials are expected to come from IRSA (IAM Roles for Service Accounts)
 * — no explicit key env vars are read. The AWS SDK's default credential chain
 * picks up the pod's bound service account token automatically on EKS.
 *
 * Configuration:
 *   AWS_REGION      — AWS region for the SES endpoint (required).
 *   SES_FROM_ADDRESS — Verified SES identity to use as the From: address (required).
 *
 * The SDK is loaded lazily via dynamic import inside `send()` so installs using
 * the `log`, `smtp`, or `resend` providers never bundle `@aws-sdk/client-ses`.
 *
 * Email dispatch failures MUST be thrown (the caller — webhook handler — catches
 * and logs them as non-fatal per the existing pattern).
 */
export class SesEmailProvider implements EmailProvider {
  private readonly fromAddress: string;
  private readonly region: string;

  constructor() {
    const fromAddress = process.env.SES_FROM_ADDRESS;
    const region = process.env.AWS_REGION;

    if (!fromAddress) {
      throw new Error(
        'SES provider missing required env: SES_FROM_ADDRESS',
      );
    }
    if (!region) {
      throw new Error(
        'SES provider missing required env: AWS_REGION',
      );
    }

    this.fromAddress = fromAddress;
    this.region = region;
  }

  async send(msg: EmailMessage): Promise<void> {
    // Dynamic import — keeps @aws-sdk/client-ses out of non-SES bundles.
    let SESClient: new (config: Record<string, unknown>) => { send: (cmd: unknown) => Promise<unknown> };
    let SendEmailCommand: new (input: Record<string, unknown>) => unknown;

    try {
      // Use dynamic require to avoid static type resolution errors when the
      // package is not installed in non-SES deployments. The dynamic import()
      // form triggers TypeScript's module resolution even with @types absent.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sesModule = require('@aws-sdk/client-ses') as {
        SESClient: new (config: Record<string, unknown>) => { send: (cmd: unknown) => Promise<unknown> };
        SendEmailCommand: new (input: Record<string, unknown>) => unknown;
      };
      SESClient = sesModule.SESClient;
      SendEmailCommand = sesModule.SendEmailCommand;
    } catch (err) {
      throw new Error(
        `[email/ses] @aws-sdk/client-ses is not installed. ` +
          `Install it with: pnpm add @aws-sdk/client-ses. ` +
          `Original error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const client = new SESClient({ region: this.region });

    const input: Record<string, unknown> = {
      Source: this.fromAddress,
      Destination: {
        ToAddresses: [msg.to],
      },
      Message: {
        Subject: {
          Data: msg.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: msg.html,
            Charset: 'UTF-8',
          },
          Text: {
            Data: msg.text,
            Charset: 'UTF-8',
          },
        },
      },
      // Configuration set groups bounces/complaints/deliveries per environment.
      ConfigurationSetName: `gibson-transactional-${process.env.NODE_ENV ?? 'development'}`,
    };

    // Forward List-Unsubscribe header if present.
    if (msg.headers?.['List-Unsubscribe']) {
      input['Headers'] = [
        {
          Name: 'List-Unsubscribe',
          Value: msg.headers['List-Unsubscribe'],
        },
      ];
    }

    const command = new SendEmailCommand(input);
    await client.send(command);
  }
}
