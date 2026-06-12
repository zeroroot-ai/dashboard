/**
 * Shared types for the secrets-backend provider sub-forms.
 *
 * BrokerFormValues is the react-hook-form schema that all sub-forms use.
 * It covers every field across all providers; each sub-form only renders the
 * fields relevant to the selected provider.
 *
 * SECURITY: sensitive string fields (vaultToken, approleSecretId, etc.) are
 * encoded to Uint8Array by the server action before the RPC and are never
 * returned to the client. They are held in react-hook-form state only for the
 * duration between user input and submit; the form is reset after submit.
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirement 3.
 */

export type BrokerProviderKey =
  | "gibson_hosted"
  | "BROKER_PROVIDER_POSTGRES"
  | "BROKER_PROVIDER_VAULT"
  | "BROKER_PROVIDER_AWSSM"
  | "BROKER_PROVIDER_GCPSM"
  | "BROKER_PROVIDER_AZUREKV";

export interface BrokerFormValues {
  /** Which provider the user has selected in the switcher. */
  provider: BrokerProviderKey;

  // -------------------------------------------------------------------------
  // Non-sensitive fields shared across providers
  // -------------------------------------------------------------------------

  /** Vault address / Azure KV vault URL */
  address: string;
  /** Vault Enterprise namespace or Community path-prefix */
  namespaceOrPath: string;
  /** Vault KV mount path */
  mount: string;
  /**
   * Auth method string, provider-specific set of allowed values.
   * Vault: "token" | "approle" | "jwt" | "kubernetes" | "aws_iam"
   * GCP: "service_account" | "workload_identity"
   * Azure: "service_principal" | "workload_identity"
   */
  authMethod: string;
  /** AWS / GCP region */
  region: string;
  /** GCP project ID */
  project: string;
  /** Azure AD tenant ID */
  tenantIdExternal: string;
  /** Azure application (client) ID */
  clientId: string;
  /** AWS IAM role ARN */
  roleArn: string;
  /** Vault AppRole role ID */
  approleRoleId: string;

  // -------------------------------------------------------------------------
  // Sensitive fields, never returned by GetBrokerConfig, write-only
  // -------------------------------------------------------------------------

  /** Vault token (auth method = token) */
  vaultToken: string;
  /** Vault AppRole secret ID (auth method = approle) */
  approleSecretId: string;
  /** AWS static access key ID */
  awsAccessKeyId: string;
  /** AWS static secret access key */
  awsSecretAccessKey: string;
  /** AWS STS external ID */
  awsExternalId: string;
  /** GCP service account JSON key file contents */
  gcpServiceAccountJson: string;
  /** Azure service principal client secret */
  azureClientSecret: string;

  /**
   * UX-only acknowledgement that switching providers will not migrate
   * existing secrets. Required (true) when showMigrationWarning is true
   * before the Save button is enabled. Never sent to the daemon, the
   * server action's Zod schema strips unknown fields.
   *
   * Reset to false whenever the selected provider changes so an
   * acknowledgement does not carry across edits.
   *
   * Spec: tenant-secrets-broker-completion R3.4.
   */
  acknowledgeMigration: boolean;
}

export const BROKER_FORM_DEFAULTS: BrokerFormValues = {
  provider: "gibson_hosted",
  address: "",
  namespaceOrPath: "",
  mount: "",
  authMethod: "",
  region: "",
  project: "",
  tenantIdExternal: "",
  clientId: "",
  roleArn: "",
  approleRoleId: "",
  // Sensitive, always start empty
  vaultToken: "",
  approleSecretId: "",
  awsAccessKeyId: "",
  awsSecretAccessKey: "",
  awsExternalId: "",
  gcpServiceAccountJson: "",
  azureClientSecret: "",
  acknowledgeMigration: false,
};
