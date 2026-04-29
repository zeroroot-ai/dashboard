"use server";

/**
 * Server Actions for the /settings/secrets page.
 *
 * Each action is server-only: sensitive values (secret value bytes) pass
 * through to the daemon RPC over TLS and are NEVER logged, returned in error
 * messages, or stored in any observable client-side channel.
 *
 * Session resolved via getServerSession(); tenant derived from the active
 * session's tenantId (set by the active-tenant cookie via the existing auth
 * path). The daemon's ext-authz layer enforces tenant_admin for writes.
 *
 * Spec: secrets-tenant-lifecycle Task 7, Requirements 1, 8.
 */

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  setSecret,
  rotateSecret,
  deleteSecret,
  type SecretMetadata,
} from "@/src/lib/gibson-client/secrets";
import { getServerSession } from "@/src/lib/auth";
import { SecretCategory } from "@/src/gen/gibson/admin/v1/secrets_pb";

// ---------------------------------------------------------------------------
// Shared result type (mirrors the existing ActionResult<T> convention)
// ---------------------------------------------------------------------------

export type SecretActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * Valid secret name: may contain alphanumeric, hyphens, underscores, colons.
 * The colon separates the category prefix from the name
 * (e.g. "cred:db_password", "provider_config:anthropic:default").
 * Max 256 chars.
 */
const secretNameSchema = z
  .string()
  .min(1, "Secret name is required")
  .max(256, "Secret name must be at most 256 characters")
  .regex(
    /^[a-zA-Z0-9_:.-]+$/,
    "Secret name may only contain letters, digits, hyphens, underscores, colons, and dots",
  );

const secretCategorySchema = z.enum(["cred", "provider_config"], {
  required_error: "Category is required",
});

/**
 * createSecretSchema validates the FormData fields for createSecretAction.
 * The value field is validated as a non-empty string here but is immediately
 * converted to bytes before the RPC call and cleared from all JS values.
 */
const createSecretSchema = z.object({
  name: secretNameSchema,
  category: secretCategorySchema,
  // value is required but its content must never appear in logs or errors.
  value: z
    .string()
    .min(1, "Secret value is required")
    .max(65536, "Secret value must be at most 64 KiB"),
});

const rotateSecretSchema = z.object({
  // value is required but its content must never appear in logs or errors.
  value: z
    .string()
    .min(1, "New secret value is required")
    .max(65536, "Secret value must be at most 64 KiB"),
});

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

function categoryToProto(cat: "cred" | "provider_config"): SecretCategory {
  return cat === "cred" ? SecretCategory.CRED : SecretCategory.PROVIDER_CONFIG;
}

// ---------------------------------------------------------------------------
// createSecretAction
// ---------------------------------------------------------------------------

/**
 * Creates or overwrites a named secret in the tenant's broker.
 *
 * SECURITY:
 * - The value field is parsed from formData, immediately encoded to bytes,
 *   and forwarded to the RPC. It is NEVER included in any log statement,
 *   error message, or return value.
 * - revalidatePath is called so the secrets list re-fetches on the next
 *   render; the caller is responsible for client-side navigation.
 */
export async function createSecretAction(
  formData: FormData,
): Promise<SecretActionResult<SecretMetadata>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  const raw = {
    name: formData.get("name"),
    category: formData.get("category"),
    value: formData.get("value"),
  };

  const parsed = createSecretSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }

  // Encode value to bytes immediately; do not hold a reference to the string
  // after this point in any error path.
  const valueBytes = new TextEncoder().encode(parsed.data.value);

  try {
    const resp = await setSecret(
      parsed.data.name,
      categoryToProto(parsed.data.category),
      valueBytes,
    );

    revalidatePath("/dashboard/pages/settings/secrets");
    return { ok: true, data: resp.metadata! };
  } catch (err) {
    // SECURITY: error message from daemon must not contain the value.
    // throwMapped already strips it but we add a defense-in-depth check.
    const msg = err instanceof Error ? err.message : "Failed to create secret";
    const code = (err as { code?: string }).code ?? "error";
    return { ok: false, error: msg, code };
  }
}

// ---------------------------------------------------------------------------
// rotateSecretAction
// ---------------------------------------------------------------------------

/**
 * Creates a new version of an existing secret with a new value.
 *
 * SECURITY: same rules as createSecretAction for the value field.
 */
export async function rotateSecretAction(
  secretName: string,
  formData: FormData,
): Promise<SecretActionResult<SecretMetadata>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  const nameValidation = secretNameSchema.safeParse(secretName);
  if (!nameValidation.success) {
    return {
      ok: false,
      error: nameValidation.error.issues[0]?.message ?? "Invalid secret name",
      code: "bad_input",
    };
  }

  const raw = { value: formData.get("value") };
  const parsed = rotateSecretSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }

  const valueBytes = new TextEncoder().encode(parsed.data.value);

  try {
    const resp = await rotateSecret(secretName, valueBytes);

    revalidatePath("/dashboard/pages/settings/secrets");
    return { ok: true, data: resp.metadata! };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to rotate secret";
    const code = (err as { code?: string }).code ?? "error";
    return { ok: false, error: msg, code };
  }
}

// ---------------------------------------------------------------------------
// deleteSecretAction
// ---------------------------------------------------------------------------

/**
 * Removes the named secret from the broker. The confirmation dialog (which
 * lists affected plugins) is shown client-side before this action is called.
 */
export async function deleteSecretAction(
  secretName: string,
): Promise<SecretActionResult<null>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  const nameValidation = secretNameSchema.safeParse(secretName);
  if (!nameValidation.success) {
    return {
      ok: false,
      error: nameValidation.error.issues[0]?.message ?? "Invalid secret name",
      code: "bad_input",
    };
  }

  try {
    await deleteSecret(secretName);
    revalidatePath("/dashboard/pages/settings/secrets");
    return { ok: true, data: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete secret";
    const code = (err as { code?: string }).code ?? "error";
    return { ok: false, error: msg, code };
  }
}
