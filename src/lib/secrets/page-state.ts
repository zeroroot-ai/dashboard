/**
 * Pure gating logic for the secrets values page.
 *
 * The Hosted broker (BrokerProvider.VAULT_HOSTED) is the platform-managed
 * default and is active for every tenant, so the add-secret path must be
 * reachable whenever the daemon responds. A genuine error ("unavailable") is
 * only shown when the broker cannot be reached at all — this replaces the old
 * "no broker configured" dead-end that trapped Hosted tenants (PRD
 * gibson#1105, dashboard#935).
 *
 * This module is intentionally free of server-only imports so it can be unit
 * tested directly.
 */

import { BrokerProvider } from "@/src/gen/gibson/tenant/v1/secrets_pb";

type SecretsBackendView = "unavailable" | "hosted" | "byo";

interface ResolveSecretsBackendViewInput {
  /** true when GetBrokerConfig responded (broker reachable). */
  reachable: boolean;
  /** the active provider enum reported by GetBrokerConfig, if any. */
  provider?: BrokerProvider;
}

/**
 * Resolves which secrets-values view to render from the broker signal.
 *
 *   - not reachable          → "unavailable" (genuine error state)
 *   - reachable + BYO        → "byo"
 *   - reachable + anything   → "hosted" (Hosted is the always-active default;
 *     an unseeded/unspecified provider still keeps the add-secret path open)
 */
export function resolveSecretsBackendView({
  reachable,
  provider,
}: ResolveSecretsBackendViewInput): SecretsBackendView {
  if (!reachable) return "unavailable";
  if (provider === BrokerProvider.VAULT_BYO) return "byo";
  return "hosted";
}
