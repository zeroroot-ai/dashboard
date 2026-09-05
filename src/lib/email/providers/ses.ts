import type { EmailMessage, EmailProvider } from '../types';

/**
 * Amazon SES v3 email provider.
 *
 * Sends transactional email via `@aws-sdk/client-ses` v3 `SendEmailCommand`.
 * Credentials are expected to come from IRSA (IAM Roles for Service Accounts)
 *, no explicit key env vars are read. The AWS SDK's default credential chain
 * picks up the pod's bound service account token automatically on EKS.
 *
 * Configuration:
 *   AWS_REGION:            AWS region for the SES endpoint (required).
 *   SES_FROM_ADDRESS:      Verified SES identity to use as the From: address (required).
 *   SES_CONFIGURATION_SET: Env-scoped SESv2 configuration set stamped on every
 *                          send (required). IaC-owned per environment
 *                          (deploy#880); never derived from NODE_ENV, that is
 *                          a build-mode flag ("production" in every prod-mode
 *                          build, staging included), not a deployment
 *                          environment.
 *
 * The SDK is loaded lazily via dynamic import inside `send()` so installs using
 * the `log`, `smtp`, or `resend` providers never bundle `@aws-sdk/client-ses`.
 *
 * Email dispatch failures MUST be thrown (the caller, webhook handler, catches
 * and logs them as non-fatal per the existing pattern).
 */
export class SesEmailProvider implements EmailProvider {
  private readonly fromAddress: string;
  private readonly region: string;
  private readonly configurationSet: string;

  constructor() {
    const fromAddress = process.env.SES_FROM_ADDRESS;
    const region = process.env.AWS_REGION;
    const configurationSet = process.env.SES_CONFIGURATION_SET;

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
    if (!configurationSet) {
      throw new Error(
        'SES provider missing required env: SES_CONFIGURATION_SET',
      );
    }

    this.fromAddress = fromAddress;
    this.region = region;
    this.configurationSet = configurationSet;
  }

  async send(msg: EmailMessage): Promise<void> {
    // Dynamic import, keeps @aws-sdk/client-ses out of non-SES bundles.
    // The package is a declared dependency since dashboard#748; the same
    // import() pattern as the smtp/resend providers.
    const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses');
    type SendEmailCommandInput = ConstructorParameters<typeof SendEmailCommand>[0];

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
      ConfigurationSetName: this.configurationSet,
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

    // input is assembled as a Record because the optional Headers field
    // below is not part of the v1 SendEmail input type.
    const command = new SendEmailCommand(input as unknown as SendEmailCommandInput);
    await client.send(command);
  }
}
