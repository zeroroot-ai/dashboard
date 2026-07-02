import 'server-only';

/**
 * Typed dashboard client methods for gibson.pluginadmin.v1.PluginAdminService.
 *
 * Backs the dashboard's plugin registration wizard and plugin detail page.
 * RegisterPlugin is atomic per Spec 2 R3.1, any partial failure rolls back
 * all created state (Zitadel SA, FGA tuples, inline secrets).
 *
 * Spec: secrets-tenant-lifecycle Task 6, Requirements 8.1.
 * NOTE: PluginAdminService is not yet served by the daemon (gibson#565);
 * expect Unavailable until that issue ships.
 */

import { userClient } from '../gibson-client';
import { PluginAdminService } from '@/src/gen/gibson/pluginadmin/v1/plugin_admin_pb';
import type {
  PluginInstallSummary,
  PluginSecretBinding,
  PluginManifestValidationError,
  ListPluginInstallsResponse,
  GetPluginInstallResponse,
  RegisterPluginResponse,
  EditPluginSecretBindingResponse,
  RevokePluginSecretBindingResponse,
  PluginInstallStatus,
} from '@/src/gen/gibson/pluginadmin/v1/plugin_admin_pb';
import { throwMapped } from './secrets';

export type {
  PluginSecretBinding,
  PluginManifestValidationError,
};

// ---------------------------------------------------------------------------
// Read methods (tenant_member+)
// ---------------------------------------------------------------------------

interface ListPluginInstallsOptions {
  nameFilter?: string;
  statusFilter?: PluginInstallStatus;
  limit?: number;
  offset?: number;
}

/**
 * Returns all plugin installs for the tenant, optionally filtered.
 */
async function listPluginInstalls(
  opts: ListPluginInstallsOptions = {},
): Promise<ListPluginInstallsResponse> {
  try {
    const client = userClient(PluginAdminService);
    return await client.listPluginInstalls({
      nameFilter: opts.nameFilter ?? '',
      statusFilter: opts.statusFilter ?? 0,
      limit: opts.limit ?? 50,
      offset: opts.offset ?? 0,
    });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Returns one install summary by install ID.
 */
export async function getPluginInstall(installId: string): Promise<GetPluginInstallResponse> {
  try {
    const client = userClient(PluginAdminService);
    return await client.getPluginInstall({ installId });
  } catch (err) {
    throwMapped(err);
  }
}

// ---------------------------------------------------------------------------
// Write methods (tenant_admin)
// ---------------------------------------------------------------------------

interface RegisterPluginOptions {
  /** The plugin manifest YAML bytes per Spec 2. */
  manifestYaml: Uint8Array;
  /** One binding per secret declared in manifest spec.secrets[]. */
  bindings: PluginSecretBinding[];
  /**
   * When true, validates without creating any state. Used by wizard Step 2
   * to surface validation errors before the final submit.
   */
  dryRun?: boolean;
}

/**
 * Atomically registers a plugin per Spec 2 R3.1.
 *
 * On success: creates the Zitadel plugin_principal SA, writes per-binding
 * FGA can_resolve tuples (creating any inline secrets in the broker), and
 * returns the bootstrap token.
 *
 * Any partial failure rolls back all created state.
 *
 * When dryRun is true, returns validation errors without side-effects.
 */
export async function registerPlugin(opts: RegisterPluginOptions): Promise<RegisterPluginResponse> {
  try {
    const client = userClient(PluginAdminService);
    return await client.registerPlugin({
      manifestYaml: opts.manifestYaml,
      bindings: opts.bindings,
      dryRun: opts.dryRun ?? false,
    });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Rebinds a plugin's declared secret to a different existing secret ref.
 * The daemon writes the new FGA tuple and removes the old one atomically.
 */
export async function editPluginSecretBinding(
  installId: string,
  declaredName: string,
  newExistingRef: string,
): Promise<EditPluginSecretBindingResponse> {
  try {
    const client = userClient(PluginAdminService);
    return await client.editPluginSecretBinding({
      installId,
      declaredName,
      newExistingRef,
    });
  } catch (err) {
    throwMapped(err);
  }
}

/**
 * Removes the FGA can_resolve tuple between a plugin and a secret.
 * Emits a secret_access_revoked audit event.
 */
export async function revokePluginSecretBinding(
  installId: string,
  declaredName: string,
): Promise<RevokePluginSecretBindingResponse> {
  try {
    const client = userClient(PluginAdminService);
    return await client.revokePluginSecretBinding({ installId, declaredName });
  } catch (err) {
    throwMapped(err);
  }
}
