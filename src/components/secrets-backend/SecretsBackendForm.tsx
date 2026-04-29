"use client";

/**
 * SecretsBackendForm — client component for the /settings/secrets-backend page.
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import {
  probeBrokerConfigAction,
  setBrokerConfigAction,
  type ProbeActionResult,
  type SetConfigActionResult,
} from "@/app/actions/secrets-backend";

import { GibsonHostedForm } from "./gibsonhosted";
import { VaultForm } from "./vault";
import { AwsSMForm } from "./awssm";
import { GcpSMForm } from "./gcpsm";
import { AzureKVForm } from "./azurekv";
import {
  BROKER_FORM_DEFAULTS,
  type BrokerFormValues,
  type BrokerProviderKey,
} from "./types";
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
    label: "Gibson-hosted Vault",
    description: "Managed HashiCorp Vault namespace (default for SaaS tenants).",
  },
  {
    key: "BROKER_PROVIDER_VAULT",
    label: "HashiCorp Vault (BYO)",
    description: "Bring your own HashiCorp Vault instance.",
  },
  {
    key: "BROKER_PROVIDER_AWSSM",
    label: "AWS Secrets Manager",
    description: "Store secrets in AWS Secrets Manager.",
  },
  {
    key: "BROKER_PROVIDER_GCPSM",
    label: "GCP Secret Manager",
    description: "Store secrets in Google Cloud Secret Manager.",
  },
  {
    key: "BROKER_PROVIDER_AZUREKV",
    label: "Azure Key Vault",
    description: "Store secrets in Azure Key Vault.",
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
// Provider migration warning dialog
// ---------------------------------------------------------------------------

interface MigrationWarningDialogProps {
  open: boolean;
  targetProvider: ProviderMeta | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

function MigrationWarningDialog({
  open,
  targetProvider,
  onConfirm,
  onCancel,
}: MigrationWarningDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-amber-500" />
            Switch secrets backend?
          </DialogTitle>
          <DialogDescription className="text-xs">
            Switching to{" "}
            <strong>{targetProvider?.label ?? "the new provider"}</strong>{" "}
            does <em>not</em> migrate existing secrets automatically. New
            secrets will be stored in the new backend; existing secrets remain
            in the old backend until manually moved or recreated. There is no
            automatic migration.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
          >
            Switch anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// SecretsBackendForm (main export)
// ---------------------------------------------------------------------------

export interface SecretsBackendFormProps {
  /**
   * Redacted config fetched server-side. null means the tenant has no
   * broker configured yet (new tenant defaults to gibson_hosted).
   */
  currentConfig: RedactedConfig | null;
  /** Whether the tenant has at least one secret stored (used to decide if
   * migration warning should fire when switching providers). */
  hasExistingSecrets: boolean;
}

export function SecretsBackendForm({
  currentConfig,
  hasExistingSecrets,
}: SecretsBackendFormProps) {
  // Map the proto BrokerProvider enum value back to the form key.
  function resolveInitialProvider(): BrokerProviderKey {
    if (!currentConfig) return "gibson_hosted";
    // The proto enum numeric values: 0=UNSPECIFIED, 1=POSTGRES, 2=VAULT,
    // 3=AWSSM, 4=GCPSM, 5=AZUREKV. The TenantAdminService always returns
    // gibson_hosted as VAULT with an empty address for managed tenants.
    // We use the address field absence as the heuristic for gibson_hosted.
    switch (currentConfig.provider) {
      case 2: // VAULT
        return currentConfig.address ? "BROKER_PROVIDER_VAULT" : "gibson_hosted";
      case 3:
        return "BROKER_PROVIDER_AWSSM";
      case 4:
        return "BROKER_PROVIDER_GCPSM";
      case 5:
        return "BROKER_PROVIDER_AZUREKV";
      default:
        return "gibson_hosted";
    }
  }

  const initialProvider = resolveInitialProvider();

  const form = useForm<BrokerFormValues>({
    defaultValues: {
      ...BROKER_FORM_DEFAULTS,
      provider: initialProvider,
      // Pre-populate non-sensitive fields from current config
      address: currentConfig?.address ?? "",
      namespaceOrPath: currentConfig?.namespaceOrPath ?? "",
      mount: currentConfig?.mount ?? "",
      authMethod: currentConfig?.authMethod ?? "",
      region: currentConfig?.region ?? "",
      project: currentConfig?.project ?? "",
      tenantIdExternal: currentConfig?.tenantIdExternal ?? "",
      clientId: currentConfig?.clientId ?? "",
      roleArn: currentConfig?.roleArn ?? "",
    },
  });

  const selectedProvider = form.watch("provider") as BrokerProviderKey;
  const authMethod = form.watch("authMethod");

  // Dialog state for migration warning
  const [pendingProvider, setPendingProvider] = React.useState<BrokerProviderKey | null>(null);

  // Probe / save result state
  const [probeResult, setProbeResult] = React.useState<ProbeActionResult | null>(null);
  const [saveResult, setSaveResult] = React.useState<SetConfigActionResult | null>(null);
  const [isProbing, setIsProbing] = React.useState(false);
  const [isSaving, setIsSaving] = React.useState(false);

  // --------------------------------------------------------------------------
  // Provider switching with migration warning
  // --------------------------------------------------------------------------

  function handleProviderChange(value: string) {
    const next = value as BrokerProviderKey;
    if (hasExistingSecrets && next !== selectedProvider) {
      setPendingProvider(next);
    } else {
      applyProviderSwitch(next);
    }
  }

  function applyProviderSwitch(next: BrokerProviderKey) {
    // Reset sensitive fields and provider-specific non-sensitive fields when
    // switching so stale values do not leak across providers.
    form.reset({
      ...BROKER_FORM_DEFAULTS,
      provider: next,
    });
    setProbeResult(null);
    setSaveResult(null);
  }

  function confirmSwitch() {
    if (pendingProvider) {
      applyProviderSwitch(pendingProvider);
      setPendingProvider(null);
    }
  }

  function cancelSwitch() {
    setPendingProvider(null);
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
          description: "Your new provider settings have been saved.",
        });
        // Reset sensitive fields only — keep non-sensitive populated for UX.
        form.reset({
          ...values,
          vaultToken: "",
          approleSecretId: "",
          awsAccessKeyId: "",
          awsSecretAccessKey: "",
          awsExternalId: "",
          gcpServiceAccountJson: "",
          azureClientSecret: "",
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
    // Map the gibson_hosted key to the VAULT provider string expected by the
    // server action (the daemon maps gibson_hosted → VAULT with empty address).
    const providerValue =
      values.provider === "gibson_hosted"
        ? "BROKER_PROVIDER_VAULT"
        : values.provider;
    fd.set("provider", providerValue);
    fd.set("address", values.provider === "gibson_hosted" ? "" : values.address);
    fd.set("namespaceOrPath", values.namespaceOrPath);
    fd.set("mount", values.mount);
    fd.set("authMethod", values.authMethod);
    fd.set("region", values.region);
    fd.set("project", values.project);
    fd.set("tenantIdExternal", values.tenantIdExternal);
    fd.set("clientId", values.clientId);
    fd.set("roleArn", values.roleArn);
    fd.set("approleRoleId", values.approleRoleId);
    // Sensitive — the server action encodes these to Uint8Array before RPC.
    fd.set("vaultToken", values.vaultToken);
    fd.set("approleSecretId", values.approleSecretId);
    fd.set("awsAccessKeyId", values.awsAccessKeyId);
    fd.set("awsSecretAccessKey", values.awsSecretAccessKey);
    fd.set("awsExternalId", values.awsExternalId);
    fd.set("gcpServiceAccountJson", values.gcpServiceAccountJson);
    fd.set("azureClientSecret", values.azureClientSecret);
    return fd;
  }

  const pendingProviderMeta = PROVIDERS.find((p) => p.key === pendingProvider);
  const isGibsonHosted = selectedProvider === "gibson_hosted";

  return (
    <div className="space-y-6">
      {/* Migration warning dialog */}
      <MigrationWarningDialog
        open={pendingProvider !== null}
        targetProvider={pendingProviderMeta}
        onConfirm={confirmSwitch}
        onCancel={cancelSwitch}
      />

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
                    handleProviderChange(v);
                  }}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger
                      className="w-full text-xs"
                      data-testid="provider-switcher"
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

          {/* Per-provider sub-form */}
          <div data-testid="provider-subform">
            {isGibsonHosted && <GibsonHostedForm />}
            {selectedProvider === "BROKER_PROVIDER_VAULT" && (
              <VaultForm
                control={form.control}
                register={form.register}
                authMethod={authMethod}
              />
            )}
            {selectedProvider === "BROKER_PROVIDER_AWSSM" && (
              <AwsSMForm control={form.control} />
            )}
            {selectedProvider === "BROKER_PROVIDER_GCPSM" && (
              <GcpSMForm control={form.control} authMethod={authMethod} />
            )}
            {selectedProvider === "BROKER_PROVIDER_AZUREKV" && (
              <AzureKVForm control={form.control} authMethod={authMethod} />
            )}
          </div>

          {/* Probe / save result banners */}
          {(probeResult || saveResult) && (
            <ProbeBanner result={saveResult ?? probeResult} />
          )}

          {/* Action buttons — hidden for Gibson-hosted (no config to save) */}
          {!isGibsonHosted && (
            <div className="flex items-center gap-2 pt-2">
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

              <Button
                type="submit"
                size="sm"
                disabled={isSaving || isProbing}
                data-testid="save-button"
              >
                {isSaving && <Loader2 className="size-3 animate-spin" />}
                {isSaving ? "Saving…" : "Save configuration"}
              </Button>
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
