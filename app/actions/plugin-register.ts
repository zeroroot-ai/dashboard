"use server";

/**
 * Server Actions for the plugin registration wizard.
 *
 * Two actions:
 *  - validatePluginManifestAction: calls RegisterPlugin in dry-run mode;
 *    returns structured validation errors with line numbers.
 *  - registerPluginAtomicAction: calls RegisterPlugin for real; on success
 *    returns the bootstrap token + CLI command snippet; on partial failure
 *    the daemon rolls back all state and returns a failure code the wizard
 *    uses to navigate to the relevant step.
 *
 * Atomicity guarantee: per Spec 2 R3.1, the daemon's RegisterPlugin handler
 * rolls back any partially-created state (Zitadel SA, FGA tuples, inline
 * secrets) on any internal error. The action surfaces the failure code so
 * the wizard can navigate the user back to the relevant step.
 *
 * Spec: secrets-tenant-lifecycle Task 9, Requirements 2, 8.
 */

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  registerPlugin,
  type PluginSecretBinding,
  type PluginManifestValidationError,
} from "@/src/lib/gibson-client/plugins-admin";
import { getServerSession } from "@/src/lib/auth";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type PluginActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export interface ValidationResult {
  valid: boolean;
  errors: PluginManifestValidationError[];
}

export interface RegisterResult {
  installId: string;
  bootstrapToken: string;
  bootstrapTokenExpiresAtUnix: bigint;
  /** The CLI enroll command the admin pastes on the plugin host. */
  enrollCommand: string;
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/**
 * A binding entry from the wizard's Step 3.
 * The dashboard sends one entry per declared secret in the manifest.
 */
const bindingSchema = z.object({
  /** The name as declared in the plugin manifest's spec.secrets[] entry. */
  declaredName: z.string().min(1).max(256),
  /**
   * "existing": bind to a broker secret that already exists.
   * "create":   create a new secret inline (create_value required).
   */
  mode: z.enum(["existing", "create"]),
  /**
   * Set when mode = "existing". The broker-namespaced secret name.
   */
  existingRef: z.string().max(256).optional().default(""),
  /**
   * Set when mode = "create". The plaintext value to store.
   * SECURITY: never logged. Encoded to bytes before the RPC.
   */
  createValue: z.string().max(65536).optional().default(""),
});

const bindingsSchema = z.array(bindingSchema).max(64);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBindings(
  parsed: z.infer<typeof bindingsSchema>,
): PluginSecretBinding[] {
  return parsed.map((b) => ({
    declaredName: b.declaredName,
    mode: b.mode,
    existingRef: b.existingRef,
    // Encode the value immediately; clear the string reference below.
    createValue:
      b.mode === "create" && b.createValue.length > 0
        ? new TextEncoder().encode(b.createValue)
        : new Uint8Array(0),
  })) as PluginSecretBinding[];
}

// ---------------------------------------------------------------------------
// validatePluginManifestAction
// ---------------------------------------------------------------------------

/**
 * Wizard Step 2: server-side validation via daemon RegisterPlugin dry-run.
 *
 * Returns { valid: true } on clean manifest, or { valid: false, errors[] }
 * with per-field line numbers when the manifest fails validation.
 *
 * No state is created — dry_run=true.
 */
export async function validatePluginManifestAction(
  manifestYaml: string,
): Promise<PluginActionResult<ValidationResult>> {
  try {
    await assertAuthorized("/gibson.admin.v1.PluginsAdminService/RegisterPlugin");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  if (!manifestYaml || manifestYaml.trim().length === 0) {
    return { ok: false, error: "Manifest is required", code: "bad_input" };
  }

  if (manifestYaml.length > 1_048_576) {
    return { ok: false, error: "Manifest exceeds 1 MiB limit", code: "bad_input" };
  }

  const manifestBytes = new TextEncoder().encode(manifestYaml);

  try {
    const resp = await registerPlugin({
      manifestYaml: manifestBytes,
      bindings: [],
      dryRun: true,
    });

    if (resp.validationErrors.length > 0) {
      return {
        ok: true,
        data: { valid: false, errors: resp.validationErrors },
      };
    }

    return { ok: true, data: { valid: true, errors: [] } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Validation failed";
    const code = (err as { code?: string }).code ?? "error";
    return { ok: false, error: msg, code };
  }
}

// ---------------------------------------------------------------------------
// registerPluginAtomicAction
// ---------------------------------------------------------------------------

/**
 * Wizard Step 4 (confirm): atomically registers the plugin.
 *
 * On success: the daemon has created the Zitadel plugin_principal SA, written
 * FGA can_resolve tuples for each binding, and returned a single-use
 * bootstrap token. The action returns the token + CLI snippet.
 *
 * On failure: the daemon rolls back all partially-created state (per Spec 2
 * R3.1). The action returns the failure code so the wizard can navigate the
 * user to the relevant step (e.g. "binding_failed" → Step 3, "manifest_invalid"
 * → Step 1).
 *
 * SECURITY: createValue bytes in bindings are encoded on this side and
 * forwarded to the RPC over TLS. They are never logged or returned.
 */
export async function registerPluginAtomicAction(
  manifestYaml: string,
  bindingsInput: unknown[],
): Promise<PluginActionResult<RegisterResult>> {
  try {
    await assertAuthorized("/gibson.admin.v1.PluginsAdminService/RegisterPlugin");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "Unauthenticated", code: "unauthenticated" };
  }

  if (!manifestYaml || manifestYaml.trim().length === 0) {
    return { ok: false, error: "Manifest is required", code: "bad_input" };
  }

  if (manifestYaml.length > 1_048_576) {
    return { ok: false, error: "Manifest exceeds 1 MiB limit", code: "bad_input" };
  }

  const parsedBindings = bindingsSchema.safeParse(bindingsInput);
  if (!parsedBindings.success) {
    return {
      ok: false,
      error: parsedBindings.error.issues[0]?.message ?? "Invalid bindings",
      code: "bad_input",
    };
  }

  const manifestBytes = new TextEncoder().encode(manifestYaml);
  const bindings = buildBindings(parsedBindings.data);

  try {
    const resp = await registerPlugin({
      manifestYaml: manifestBytes,
      bindings,
      dryRun: false,
    });

    // If the RPC returned validation errors despite not being a dry-run, the
    // manifest was invalid. Surface the errors with the manifest_invalid code
    // so the wizard navigates back to Step 1.
    if (resp.validationErrors.length > 0) {
      const first = resp.validationErrors[0]!;
      return {
        ok: false,
        error: `Manifest validation failed: ${first.message} (line ${first.line})`,
        code: "manifest_invalid",
      };
    }

    const enrollCommand =
      `gibson-cli plugin enroll --token ${resp.bootstrapToken}`;

    revalidatePath("/dashboard/pages/settings/plugins");
    return {
      ok: true,
      data: {
        installId: resp.installId,
        bootstrapToken: resp.bootstrapToken,
        bootstrapTokenExpiresAtUnix: resp.bootstrapTokenExpiresAtUnix,
        enrollCommand,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Registration failed";
    const code = (err as { code?: string }).code ?? "error";

    // Map well-known daemon error codes to wizard-step navigation codes.
    // The daemon uses structured codes per Spec 2 R3.1 rollback semantics.
    const wizardCode = mapToWizardCode(code, msg);
    return { ok: false, error: msg, code: wizardCode };
  }
}

/**
 * Maps daemon-side error codes to wizard-step codes so the client can
 * navigate the user back to the relevant step.
 *
 * Codes are best-effort; the wizard falls back to the confirm step if the
 * code is unrecognised.
 */
function mapToWizardCode(daemonCode: string, msg: string): string {
  if (daemonCode === "invalid_argument") return "manifest_invalid";
  if (daemonCode === "failed_precondition") {
    if (msg.includes("broker") || msg.includes("secret")) return "binding_failed";
    return "precondition_failed";
  }
  if (daemonCode === "already_exists") return "already_registered";
  return daemonCode;
}
