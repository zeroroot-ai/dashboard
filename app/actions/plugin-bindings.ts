"use server";

/**
 * Server Actions for plugin secret-binding mutations from the plugin detail page.
 *
 * Wraps `pluginsAdmin.editPluginSecretBinding` and `revokePluginSecretBinding`
 * so the client `PluginDetailContent` component can call them without dragging
 * server-only auth into the client bundle.
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import "server-only";

import { revalidatePath } from "next/cache";
import {
  editPluginSecretBinding,
  revokePluginSecretBinding,
} from "@/src/lib/gibson-client/plugins-admin";

export interface PluginBindingResult {
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
