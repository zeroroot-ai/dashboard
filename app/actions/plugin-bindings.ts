"use server";

/**
 * Server Actions for plugin secret-binding mutations from the plugin detail page.
 *
 * Wraps `pluginsAdmin.editPluginSecretBinding` and `revokePluginSecretBinding`
 * so the client `PluginDetailContent` component can call them without dragging
 * server-only auth into the client bundle.
 *
 * Authz: assertAuthorized is called at the top of each action before any
 * daemon call (spec: dashboard-authz-ui-gating Requirements 6.1, 6.5).
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import "server-only";

import { revalidatePath } from "next/cache";
import {
  editPluginSecretBinding,
  revokePluginSecretBinding,
} from "@/src/lib/gibson-client/plugins-admin";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

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
    await assertAuthorized(
      "/gibson.pluginadmin.v1.PluginAdminService/EditPluginSecretBinding",
    );
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied" };
    }
    throw err;
  }

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
    await assertAuthorized(
      "/gibson.pluginadmin.v1.PluginAdminService/RevokePluginSecretBinding",
    );
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied" };
    }
    throw err;
  }

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
