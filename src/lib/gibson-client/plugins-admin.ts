// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';

/**
 * Typed dashboard client methods for gibson.pluginadmin.v1.PluginAdminService.
 *
 * Backs the plugin detail page and the secret-binding actions. The register
 * wrapper left with the UI-less registration actions (gibson#555): a plugin
 * declares itself at check-in (ADR-0097), and the deploy wizard registers
 * through the register API.
 */

import { userClient } from '../gibson-client';
import { PluginAdminService } from '@/src/gen/gibson/pluginadmin/v1/plugin_admin_pb';
import type {
  PluginInstallSummary,
  ListPluginInstallsResponse,
  GetPluginInstallResponse,
  EditPluginSecretBindingResponse,
  RevokePluginSecretBindingResponse,
  PluginInstallStatus,
} from '@/src/gen/gibson/pluginadmin/v1/plugin_admin_pb';
import { throwMapped } from './secrets';

// ---------------------------------------------------------------------------
// Read methods (tenant_member+)
// ---------------------------------------------------------------------------

interface ListPluginInstallsOptions {
  nameFilter?: string;
  statusFilter?: PluginInstallStatus;
  /** Page size; 0 or absent takes the daemon default. */
  pageSize?: number;
  /** The `nextPageToken` of the previous page; empty for the first page. */
  pageToken?: string;
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
      pageSize: opts.pageSize ?? 50,
      pageToken: opts.pageToken ?? '',
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
