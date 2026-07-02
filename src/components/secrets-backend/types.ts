/**
 * Shared types for the secrets-backend provider sub-forms.
 *
 * BrokerFormValues is the react-hook-form schema that all sub-forms use.
 * There are exactly two backends: the platform-managed Hosted broker
 * (VAULT_HOSTED, zero configuration) and a customer-supplied BYO Vault
 * (VAULT_BYO). The retired AWS/GCP/Azure backends and their fields have been
 * removed (secrets-hosted-byo epic, PRD gibson#1105).
 *
 * SECURITY: sensitive string fields (vaultToken, approleSecretId) are
 * encoded to Uint8Array by the server action before the RPC and are never
 * returned to the client. They are held in react-hook-form state only for the
 * duration between user input and submit; the form is reset after submit.
 */

export type BrokerProviderKey =
  // Platform-managed Hosted broker (maps to BrokerProvider.VAULT_HOSTED).
  | "gibson_hosted"
  // Customer-supplied BYO Vault (maps to BrokerProvider.VAULT_BYO).
  | "BROKER_PROVIDER_VAULT_BYO";

export interface BrokerFormValues {
  /** Which backend the user has selected in the switcher. */
  provider: BrokerProviderKey;

  // -------------------------------------------------------------------------
  // Non-sensitive fields (BYO Vault only)
  // -------------------------------------------------------------------------

  /** Vault address */
  address: string;
  /** Vault Enterprise namespace or Community path-prefix */
  namespaceOrPath: string;
  /** Vault KV mount path */
  mount: string;
  /**
   * Auth method string.
   * Vault: "token" | "approle" | "jwt" | "kubernetes" | "aws_iam"
   */
  authMethod: string;
  /** Vault AppRole role ID */
  approleRoleId: string;

  // -------------------------------------------------------------------------
  // Sensitive fields, never returned by GetBrokerConfig, write-only
  // -------------------------------------------------------------------------

  /** Vault token (auth method = token) */
  vaultToken: string;
  /** Vault AppRole secret ID (auth method = approle) */
  approleSecretId: string;

  /**
   * UX-only acknowledgement that switching backends will not migrate
   * existing secrets. Required (true) when showMigrationWarning is true
   * before the Save button is enabled. Never sent to the daemon, the
   * server action's Zod schema strips unknown fields.
   *
   * Reset to false whenever the selected backend changes so an
   * acknowledgement does not carry across edits.
   */
  acknowledgeMigration: boolean;
}

export const BROKER_FORM_DEFAULTS: BrokerFormValues = {
  provider: "gibson_hosted",
  address: "",
  namespaceOrPath: "",
  mount: "",
  authMethod: "",
  approleRoleId: "",
  // Sensitive, always start empty
  vaultToken: "",
  approleSecretId: "",
  acknowledgeMigration: false,
};
