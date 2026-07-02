"use server";

/**
 * Server Actions for plugin secret-binding mutations from the plugin detail page.
 *
 * Wraps `pluginsAdmin.editPluginSecretBinding` and `revokePluginSecretBinding`
 * so the client `PluginDetailContent` component can call them without dragging
 * server-only auth into the client bundle.
 *
 * Authz: both wrapped RPCs dispatch through the user-acting client, which
 * bakes a per-RPC assertAuthorized check into the transport (dashboard#848 /
 * #902); a denial surfaces as AuthzDeniedError from inside the call and is
 * mapped to the canonical "Permission denied" result (dashboard#904).
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import "server-only";

import { revalidatePath } from "next/cache";
import {
  editPluginSecretBinding,
  revokePluginSecretBinding,
} from "@/src/lib/gibson-client/plugins-admin";
import { permissionDeniedResult } from "@/src/lib/auth/assert-authorized";

interface PluginBindingResult {
  ok: boolean;
  error?: string;
}

export async function editPluginBindingAction(
  installId: string,
  declaredName: string,
  newRef: string,
): Promise<PluginBindingResult> {
  try {
    await editPluginSecretBinding(installId, declaredName, newRef);
    revalidatePath(`/dashboard/pages/settings/plugins/${installId}`);
    return { ok: true };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function revokePluginBindingAction(
  installId: string,
  declaredName: string,
): Promise<PluginBindingResult> {
  try {
    await revokePluginSecretBinding(installId, declaredName);
    revalidatePath(`/dashboard/pages/settings/plugins/${installId}`);
    return { ok: true };
  } catch (err) {
    const denied = permissionDeniedResult(err);
    if (denied) return denied;
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
