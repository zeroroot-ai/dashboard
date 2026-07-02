"use client";

/**
 * SecretsBackendForm, client component for the /settings/secrets-backend page.
 *
 * Renders a provider switcher (Select) and the matching per-provider sub-form.
 * Probe button calls probeBrokerConfigAction server action and displays the
 * structured result inline. Save button calls setBrokerConfigAction (which
 * probes again server-side) and shows a toast on success.
 *
 * Switching providers when there are existing secrets shows a warning dialog
 * about no automatic migration.
 *
 * SECURITY: sensitive form fields use type="password" autoComplete="off".
 * The form is reset (via react-hook-form reset()) on successful submit so
 * that plaintext values do not linger in form state.
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirement 3.
 */

import * as React from "react";
import { useForm } from "react-hook-form";
import { Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

import {
  probeBrokerConfigAction,
  setBrokerConfigAction,
  type ProbeActionResult,
  type SetConfigActionResult,
} from "@/app/actions/secrets-backend";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

import { GibsonHostedForm } from "./gibsonhosted";
import { VaultForm } from "./vault";
import {
  BROKER_FORM_DEFAULTS,
  type BrokerFormValues,
  type BrokerProviderKey,
} from "./types";
import { BrokerProvider } from "@/src/gen/gibson/tenant/v1/secrets_pb";
import type { RedactedConfig } from "@/src/lib/gibson-client/tenant-broker-config";

// ---------------------------------------------------------------------------
// Provider display metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  key: BrokerProviderKey;
  label: string;
  description: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    key: "gibson_hosted",
    label: "Hosted",
    description:
      "Platform-managed OpenBao broker. Zero configuration; already active for every tenant.",
  },
  {
    key: "BROKER_PROVIDER_VAULT_BYO",
    label: "BYO Vault",
    description: "Bring your own HashiCorp Vault / OpenBao instance.",
  },
];

// ---------------------------------------------------------------------------
// Probe result banner
// ---------------------------------------------------------------------------

interface ProbeBannerProps {
  result: ProbeActionResult | SetConfigActionResult | null;
}

function ProbeBanner({ result }: ProbeBannerProps) {
  if (!result) return null;

  if (result.ok) {
    const data = (result as { ok: true; data: { ok?: boolean; durationMs?: bigint } }).data;
    const durationMs = data?.durationMs != null ? Number(data.durationMs) : null;
    return (
      <Alert className="border-green-500/30 bg-green-500/10">
        <CheckCircle2 className="size-4 text-green-600" />
        <AlertDescription className="text-xs text-green-700 dark:text-green-400">
          Probe succeeded
          {durationMs !== null ? ` in ${durationMs} ms.` : "."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <XCircle className="size-4" />
      <AlertDescription className="text-xs">
        {result.error}
        {(result as { ok: false; errorClass?: string }).errorClass && (
          <span className="text-muted-foreground ml-2 font-mono text-[10px]">
            [{(result as { ok: false; errorClass?: string }).errorClass}]
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// SecretsBackendForm (main export)
// ---------------------------------------------------------------------------

interface SecretsBackendFormProps {
  /**
   * Redacted config fetched server-side. null means the tenant has no
   * broker configured yet (new tenant defaults to gibson_hosted).
   */
  currentConfig: RedactedConfig | null;
  /**
   * Number of secrets currently stored in the tenant's active broker.
   * Used to decide whether to show the migration warning + acknowledgement
   * checkbox when the user picks a different provider.
   *
   * Sentinel -1 means "unknown", the daemon's CountSecrets RPC was
   * unreachable. In that case the form behaves conservatively: warning +
   * checkbox shown on any provider change. See spec
   * tenant-secrets-broker-completion R3.6 + design D4.
   */
  secretCount: number;
  /**
   * The active tenant id (derived server-side from the session/tenant
   * context). Used to pre-fill the BYO path-prefix with the tenant-scoped
   * default `tenant/<tenant-id>` when the tenant has no saved value. This
   * mirrors the daemon codec's DefaultPathPrefix so probe/save land the same
   * isolation path the daemon would otherwise default to (brokercodec,
   * gibson#1121).
   */
  tenantId: string;
}

export function SecretsBackendForm({
  currentConfig,
  secretCount,
  tenantId,
}: SecretsBackendFormProps) {
  // Tenant-scoped default KV path prefix for BYO (path-prefix) mode. Mirrors
  // the daemon's brokercodec.DefaultPathPrefix ("tenant/<tenant-id>"). OSS
  // Vault / OpenBao CE has no namespaces, so tenant isolation on a customer's
  // own Vault comes from this prefix.
  const defaultPathPrefix = `tenant/${tenantId}`;

  // Map the active BrokerProvider enum reported by GetBrokerConfig back to the
  // form key. The selector defaults to whichever backend is actually active
  // for the tenant (VAULT_HOSTED → Hosted, VAULT_BYO → BYO Vault). No
  // heuristics — the daemon reports the explicit enum.
  function resolveInitialProvider(): BrokerProviderKey {
    if (currentConfig?.provider === BrokerProvider.VAULT_BYO) {
      return "BROKER_PROVIDER_VAULT_BYO";
    }
    // Hosted is the always-active default for every tenant, so anything that
    // is not explicitly BYO (including no config yet) shows Hosted.
    return "gibson_hosted";
  }

  const initialProvider = resolveInitialProvider();

  const form = useForm<BrokerFormValues>({
    defaultValues: {
      ...BROKER_FORM_DEFAULTS,
      provider: initialProvider,
      // Pre-populate non-sensitive BYO fields from current config. When there
      // is no saved path prefix, seed the tenant-scoped default so the BYO
      // form is never blank (PRD gibson#1105 story 7). authMethod defaults to
      // "token" so the token field renders and a valid auth method is always
      // carried in the candidate.
      address: currentConfig?.address ?? "",
      namespaceOrPath: currentConfig?.namespaceOrPath || defaultPathPrefix,
      mount: currentConfig?.mount ?? "",
      authMethod: currentConfig?.authMethod || "token",
    },
  });

  const selectedProvider = form.watch("provider") as BrokerProviderKey;
  const authMethod = form.watch("authMethod");
  const acknowledgeMigration = form.watch("acknowledgeMigration");

  // showMigrationWarning gates the inline warning + acknowledgement
  // checkbox below. Spec tenant-secrets-broker-completion R3.3/3.4/3.6:
  //
  //   - secretCount === 0       → no warning at all (nothing to orphan)
  //   - secretCount > 0         → warning + checkbox required to enable Save
  //   - secretCount === -1      → conservative path (RPC unreachable; assume
  //                               there might be secrets and show the warning)
  //
  // The condition also requires the user to actually be switching providers
  //, staying on the current provider does not orphan anything.
  const showMigrationWarning =
    selectedProvider !== initialProvider &&
    (secretCount > 0 || secretCount === -1);

  // Probe / save result state
  const [probeResult, setProbeResult] = React.useState<ProbeActionResult | null>(null);
  const [saveResult, setSaveResult] = React.useState<SetConfigActionResult | null>(null);
  const [isProbing, setIsProbing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // Authz: gate Probe and Save on their respective RPCs.
  // Disable inputs for non-admins (read-only view).
  // Spec: dashboard-authz-ui-gating Task 15, Requirement 5.6.
  const { allowed: canProbe, loading: probeAuthLoading } = useAuthorize(
    "/gibson.tenant.v1.SecretsService/ProbeBrokerConfig",
  );
  const { allowed: canSave, loading: saveAuthLoading } = useAuthorize(
    "/gibson.tenant.v1.SecretsService/SetBrokerConfig",
  );
  const isReadOnly = probeAuthLoading || saveAuthLoading || (!canProbe && !canSave);

  // --------------------------------------------------------------------------
  // Provider switching
  //
  // Switching providers must NOT silently blank the user's typed values (PRD
  // gibson#1105 story 10). Previously this called form.reset() to the empty
  // defaults, wiping the address / path-prefix / auth every time the user
  // toggled providers. Now we preserve every field and only:
  //   - re-derive the tenant-scoped path-prefix default if the field is empty,
  //     so a first switch into BYO always lands a sensible prefix, and
  //   - reset the migration acknowledgement to false so an ack never carries
  //     across a provider change (spec tenant-secrets-broker-completion R3.4).
  // The provider itself is already updated by the Select's field.onChange.
  // Probe/save banners are cleared so stale results don't linger.
  // --------------------------------------------------------------------------

  function handleProviderChange() {
    if (!form.getValues("namespaceOrPath")) {
      form.setValue("namespaceOrPath", defaultPathPrefix);
    }
    form.setValue("acknowledgeMigration", false);
    setProbeResult(null);
    setSaveResult(null);
  }

  // --------------------------------------------------------------------------
  // Probe action
  // --------------------------------------------------------------------------

  async function handleProbe() {
    setProbeResult(null);
    setSaveResult(null);
    setIsProbing(true);
    try {
      const formData = buildFormData(form.getValues());
      const result = await probeBrokerConfigAction(formData);
      setProbeResult(result);
    } finally {
      setIsProbing(false);
    }
  }

  // --------------------------------------------------------------------------
  // Save action
  // --------------------------------------------------------------------------

  async function handleSave(values: BrokerFormValues) {
    setProbeResult(null);
    setSaveResult(null);
    setIsSaving(true);
    try {
      const formData = buildFormData(values);
      const result = await setBrokerConfigAction(formData);
      setSaveResult(result);

      if (result.ok) {
        toast.success("Secrets backend configured", {
          description: "Your new backend settings have been saved.",
        });
        // Reset sensitive fields only, keep non-sensitive populated for UX.
        form.reset({
          ...values,
          vaultToken: "",
          approleSecretId: "",
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function buildFormData(values: BrokerFormValues): FormData {
    const fd = new FormData();
    // Map the form key to the explicit BrokerProvider enum string the server
    // action expects (Hosted → VAULT_HOSTED, BYO → VAULT_BYO).
    const providerValue =
      values.provider === "gibson_hosted"
        ? "BROKER_PROVIDER_VAULT_HOSTED"
        : "BROKER_PROVIDER_VAULT_BYO";
    fd.set("provider", providerValue);
    // These wire fields feed the daemon's brokercodec.EncodeCandidate
    // (gibson#1121), which projects them onto the vault.Config the provider
    // consumes:
    //   namespaceOrPath → path_prefix (BYO; empty defaults to tenant/<id>)
    //   mount           → kv_mount
    //   authMethod      → auth.method
    //   vaultToken      → auth.token           (token auth)
    //   approleRoleId   → auth.app_role_id     (approle auth)
    //   approleSecretId → auth.app_role_secret_id
    fd.set("address", values.provider === "gibson_hosted" ? "" : values.address);
    fd.set("namespaceOrPath", values.namespaceOrPath);
    fd.set("mount", values.mount);
    fd.set("authMethod", values.authMethod);
    fd.set("approleRoleId", values.approleRoleId);
    // Sensitive, the server action encodes these to Uint8Array before RPC.
    fd.set("vaultToken", values.vaultToken);
    fd.set("approleSecretId", values.approleSecretId);
    return fd;
  }

  const isGibsonHosted = selectedProvider === "gibson_hosted";
  const targetProviderLabel =
    PROVIDERS.find((p) => p.key === selectedProvider)?.label ?? "the new provider";

  return (
    <div className="space-y-6">
      {/* Existing config summary */}
      {currentConfig && (
        <div className="text-xs text-muted-foreground">
          Last configured{" "}
          {currentConfig.updatedBy ? (
            <span>
              by <span className="font-mono">{currentConfig.updatedBy}</span>
            </span>
          ) : null}
          {currentConfig.updatedAtUnix && currentConfig.updatedAtUnix > BigInt(0) ? (
            <span>
              {" "}
              at{" "}
              {new Date(Number(currentConfig.updatedAtUnix) * 1000).toLocaleString()}
            </span>
          ) : null}
          {currentConfig.sensitiveFieldsSet?.length > 0 && (
            <span className="ml-2">
              (configured:{" "}
              {currentConfig.sensitiveFieldsSet.join(", ")})
            </span>
          )}
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSave)} className="space-y-6">
          {/* Provider switcher */}
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs font-medium">
                  Secrets Backend Provider
                </FormLabel>
                <Select
                  onValueChange={(v) => {
                    field.onChange(v);
                    handleProviderChange();
                  }}
                  defaultValue={field.value}
                  disabled={isReadOnly}
                >
                  <FormControl>
                    <SelectTrigger
                      className="w-full text-xs"
                      data-testid="provider-switcher"
                      disabled={isReadOnly}
                    >
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.key} value={p.key} className="text-xs">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <Separator />

          {/* Per-backend sub-form */}
          <div data-testid="provider-subform">
            {isGibsonHosted && <GibsonHostedForm />}
            {selectedProvider === "BROKER_PROVIDER_VAULT_BYO" && (
              <VaultForm
                control={form.control}
                register={form.register}
                authMethod={authMethod}
              />
            )}
          </div>

          {/* Migration warning + acknowledgement checkbox.
              Visible only when the user is switching providers AND the
              tenant currently has secrets (or the count RPC is unreachable
             , sentinel -1 falls back to the conservative warning).
              Spec: tenant-secrets-broker-completion R3.3, R3.4, R3.6. */}
          {showMigrationWarning && (
            <Alert variant="default" className="border-amber-500/50" data-testid="migration-warning">
              <AlertTriangle className="size-4 text-amber-500" />
              <AlertDescription className="space-y-3 text-xs">
                <div>
                  Switching to <strong>{targetProviderLabel}</strong> does{" "}
                  <em>not</em> migrate existing secrets automatically. New
                  secrets will be stored in the new backend; existing secrets
                  remain in the old backend until manually moved or recreated.
                  {secretCount === -1 && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">
                        (Could not load current secret count; assuming there
                        may be existing secrets.)
                      </span>
                    </>
                  )}
                </div>
                <FormField
                  control={form.control}
                  name="acknowledgeMigration"
                  render={({ field }) => (
                    <FormItem className="flex items-start gap-2 space-y-0">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="acknowledge-migration"
                        />
                      </FormControl>
                      <FormLabel className="text-xs font-normal leading-tight">
                        I understand existing secrets will not be migrated to
                        the new provider.
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </AlertDescription>
            </Alert>
          )}

          {/* Probe / save result banners */}
          {(probeResult || saveResult) && (
            <ProbeBanner result={saveResult ?? probeResult} />
          )}

          {/* Action buttons, hidden for Gibson-hosted (no config to save)
              and hidden for non-admins (read-only mode). */}
          {!isGibsonHosted && !isReadOnly && (
            <div className="flex items-center gap-2 pt-2">
              {!probeAuthLoading && canProbe && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isProbing || isSaving}
                  onClick={handleProbe}
                  data-testid="probe-button"
                >
                  {isProbing && <Loader2 className="size-3 animate-spin" />}
                  {isProbing ? "Probing…" : "Test connection"}
                </Button>
              )}

              {!saveAuthLoading && canSave && (
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    isSaving ||
                    isProbing ||
                    (showMigrationWarning && !acknowledgeMigration)
                  }
                  data-testid="save-button"
                >
                  {isSaving && <Loader2 className="size-3 animate-spin" />}
                  {isSaving ? "Saving…" : "Save configuration"}
                </Button>
              )}
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
