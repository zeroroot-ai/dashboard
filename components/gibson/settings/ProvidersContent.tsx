"use client";

/**
 * ProvidersContent
 *
 * Descriptor-driven LLM provider configuration panel for Gibson settings.
 *
 * The form renders whatever credential fields the daemon's GetSupportedProviders
 * RPC descriptor returns for the selected provider type, no hard-coded
 * per-provider configuration. Adding a new daemon provider automatically
 * surfaces in the dropdown and form without a dashboard code change.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, Pencil, Plug, Star, Trash2, WifiOff } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { formatDistanceToNow } from "date-fns";

import { useSupportedProviders } from "@/src/hooks/useSupportedProviders";
import { useProviders, providerQueryKeys } from "@/src/hooks/useProviders";
import { useCreateProvider, useDeleteProvider, useSetDefaultProvider, useUpdateProvider } from "@/src/hooks/useProviderMutations";
import { useProviderHealth } from "@/src/hooks/useProviderHealth";
import { CREDENTIAL_FIELD_TYPE } from '@/src/lib/gibson-client-types';
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';
import type { ProviderConfig, ProviderHealthStatus } from "@/src/types/provider";
import { HEALTH_STATUS_CONFIG } from "@/src/types/provider";
import { useQueryClient } from "@tanstack/react-query";

import { ProviderWizard, CredentialsAndTest, type ProbeResult } from "./ProviderWizard";

// ---------------------------------------------------------------------------
// Health badge helpers
// ---------------------------------------------------------------------------

const HEALTH_BADGE_VARIANT: Record<
  ProviderHealthStatus,
  "success" | "warning" | "destructive" | "outline"
> = {
  healthy: "success",
  degraded: "warning",
  unhealthy: "destructive",
  unknown: "outline",
};

function formatRelativeTime(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// DynamicCredentialForm, retained for backward-compat with tests + the
// onboarding flow. The Settings → Providers page uses ProviderWizard now.
// ---------------------------------------------------------------------------

interface DynamicFormValues {
  name: string;
  defaultModel: string;
  setAsDefault: boolean;
  credentials: Record<string, string>;
}

interface DynamicCredentialFormProps {
  descriptor: SupportedProviderDescriptor;
  onSubmit: (values: DynamicFormValues) => void;
  isPending: boolean;
}

export function DynamicCredentialForm({ descriptor, onSubmit, isPending }: DynamicCredentialFormProps) {
  const form = useForm<DynamicFormValues>({
    defaultValues: {
      name: descriptor.type,
      defaultModel: descriptor.defaultModels[0]?.name ?? "",
      setAsDefault: false,
      credentials: {},
    },
  });

  function handleSubmit(values: DynamicFormValues) {
    onSubmit(values);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "Name is required" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={descriptor.type}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Unique name for this provider instance (e.g. &ldquo;anthropic-prod&rdquo;).
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Dynamic credential fields from descriptor */}
        {descriptor.credentials.map((field) => {
          const rawFieldType = field.fieldType ?? CREDENTIAL_FIELD_TYPE.UNSPECIFIED;
          const effectiveType =
            rawFieldType !== CREDENTIAL_FIELD_TYPE.UNSPECIFIED
              ? rawFieldType
              : field.secret
                ? CREDENTIAL_FIELD_TYPE.PASSWORD
                : CREDENTIAL_FIELD_TYPE.TEXT;
          const isBool = effectiveType === CREDENTIAL_FIELD_TYPE.BOOL;
          const isRegion = effectiveType === CREDENTIAL_FIELD_TYPE.REGION;
          const isUrl = effectiveType === CREDENTIAL_FIELD_TYPE.URL;
          const listId = `${field.key}-regions`;
          return (
            <FormField
              key={field.key}
              control={form.control}
              name={`credentials.${field.key}`}
              rules={{ required: field.required ? `${field.label} is required` : false }}
              render={({ field: formField }) => (
                <FormItem>
                  {!isBool && (
                    <FormLabel className="text-xs">
                      {field.label}
                      {field.required && (
                        <span className="text-destructive ml-1" aria-label="required">
                          *
                        </span>
                      )}
                    </FormLabel>
                  )}
                  <FormControl>
                    {isBool ? (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={field.key}
                          checked={formField.value === "true"}
                          onCheckedChange={(checked) => {
                            formField.onChange({
                              target: { value: checked ? "true" : "false" },
                            } as React.ChangeEvent<HTMLInputElement>);
                          }}
                        />
                        <label htmlFor={field.key} className="cursor-pointer text-xs">
                          {field.label}
                        </label>
                      </div>
                    ) : isRegion ? (
                      <>
                        <Input
                          {...formField}
                          type="text"
                          list={listId}
                          placeholder={field.placeholder || undefined}
                          className="font-mono text-xs"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                        />
                        <datalist id={listId}>
                          {["us-east-1","us-east-2","us-west-1","us-west-2","ca-central-1","eu-west-1","eu-west-2","eu-central-1","eu-north-1","ap-southeast-1","ap-southeast-2","ap-northeast-1","ap-south-1","sa-east-1"].map((r) => (
                            <option key={r} value={r} />
                          ))}
                          {["us-central1","us-east1","us-east4","us-west1","europe-west1","europe-west2","asia-east1","asia-northeast1","asia-south1","australia-southeast1"].map((r) => (
                            <option key={r} value={r} />
                          ))}
                        </datalist>
                      </>
                    ) : (
                      <Input
                        {...formField}
                        type={isUrl ? "url" : effectiveType === CREDENTIAL_FIELD_TYPE.PASSWORD ? "password" : "text"}
                        placeholder={field.placeholder || undefined}
                        className="font-mono text-xs"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    )}
                  </FormControl>
                  {field.help && (
                    <FormDescription className="text-xs">{field.help}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          );
        })}

        {descriptor.defaultModels.length > 0 && (
          <FormField
            control={form.control}
            name="defaultModel"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs">Default Model</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full text-xs">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {descriptor.defaultModels.map((m) => (
                      <SelectItem key={m.name} value={m.name} className="font-mono text-xs">
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="text-xs"
            disabled={isPending}
          >
            {isPending && <Loader2 className="size-3 animate-spin" />}
            Add Provider
          </Button>
        </div>
      </form>
    </Form>
  );
}

// AddProviderDialog was replaced by ProviderWizard (multi-step type-pick →
// connect+test → model-pick+save with live model fetching). The page-level
// component renders the wizard inline for the empty state and inside a
// Dialog for "Add another." See ProviderWizard.tsx.

// ---------------------------------------------------------------------------
// ConfiguredProviderRow
// ---------------------------------------------------------------------------

interface ConfiguredProviderRowProps {
  provider: ProviderConfig;
  /** Matching descriptor from the supported providers list, used by the edit dialog. */
  descriptor?: SupportedProviderDescriptor;
}

function ConfiguredProviderRow({ provider, descriptor }: ConfiguredProviderRowProps) {
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "fail">("idle");

  const { mutate: deleteProvider, isPending: isDeleting } = useDeleteProvider();
  const { mutate: setDefault, isPending: isSettingDefault } = useSetDefaultProvider();
  const { mutate: updateProvider, isPending: isUpdating } = useUpdateProvider();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = React.useState(false);
  const [editCredentials, setEditCredentials] = React.useState<Record<string, string>>({});
  const [editProbeResult, setEditProbeResult] = React.useState<ProbeResult | null>(null);
  const [isEditTestPending, setIsEditTestPending] = React.useState(false);

  // Live health badge, polls every 60 s, pauses when the tab is hidden.
  const { data: health } = useProviderHealth(provider.name);
  const healthStatus = health?.status ?? 'unknown';
  const healthConfig = HEALTH_STATUS_CONFIG[healthStatus];
  const healthVariant = HEALTH_BADGE_VARIANT[healthStatus];

  // isEnabled is the proto3 default false when the daemon doesn't explicitly
  // set it; fall back to checking whether any credential values are non-empty
  // so the badge reflects reality when the field is omitted.
  const hasCredentials = provider.credentialsMasked
    ? Object.values(provider.credentialsMasked).some((v) => v !== "")
    : !!provider.apiKeyMasked;
  const isConfigured = hasCredentials || provider.isEnabled;

  function onSaveCredentials() {
    updateProvider(
      { name: provider.name, config: { credentials: editCredentials } },
      {
        onSuccess: () => {
          toast.success(`${provider.displayName} credentials updated`);
          setEditOpen(false);
          setEditProbeResult(null);
          void queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
        },
        onError: (err) => {
          toast.error(`Failed to update ${provider.displayName} credentials`, {
            description: err.message,
          });
        },
      },
    );
  }

  async function runEditTest(values: { name: string; credentials: Record<string, string> }) {
    if (!descriptor) return;
    setIsEditTestPending(true);
    setEditProbeResult(null);
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: descriptor.type,
          name: provider.name,
          defaultModel: descriptor.defaultModels[0]?.name ?? "",
          credentials: values.credentials,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: ProbeResult;
        error?: { message?: string } | string;
      };
      if (!res.ok) {
        const msg = typeof body.error === "string"
          ? body.error
          : (body.error?.message ?? `Test failed (HTTP ${res.status})`);
        setEditProbeResult({ ok: false, latencyMs: 0, error: msg, models: [] });
      } else {
        setEditProbeResult(body.result ?? { ok: false, latencyMs: 0, error: "No result", models: [] });
      }
    } catch (err) {
      setEditProbeResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Unknown error",
        models: [],
      });
    } finally {
      setIsEditTestPending(false);
    }
  }

  async function onTestConnection() {
    setTestState("testing");
    try {
      const res = await fetch(
        `/api/settings/providers/${encodeURIComponent(provider.name)}/health`,
      );
      const json = await res.json();
      if (!res.ok) {
        setTestState("fail");
        // json.error may be { code, message }, always extract the string
        const msg =
          typeof json.error === "string"
            ? json.error
            : (json.error?.message ?? "Unknown error");
        toast.error(`Connection to ${provider.displayName} failed`, {
          description: msg,
        });
        return;
      }
      const health = json.health;
      if (health?.status === "healthy") {
        setTestState("ok");
        toast.success(`${provider.displayName} connection verified`);
      } else {
        setTestState("fail");
        toast.error(`Connection to ${provider.displayName} failed`, {
          description: health?.lastError ?? "Provider is not healthy",
        });
      }
    } catch (err) {
      setTestState("fail");
      toast.error(`Connection to ${provider.displayName} failed`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function onDelete() {
    deleteProvider(provider.name, {
      onSuccess: () => {
        toast.success(`${provider.displayName} removed`);
      },
      onError: (err) => {
        toast.error(`Failed to remove ${provider.displayName}`, {
          description: err.message,
        });
      },
    });
  }

  function onSetDefault() {
    setDefault(provider.name, {
      onSuccess: () => {
        toast.success(`${provider.displayName} set as default`);
      },
      onError: (err) => {
        toast.error(`Failed to set default`, {
          description: err.message,
        });
      },
    });
  }

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="border-border/60 bg-muted/40 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-semibold">
              {provider.displayName.charAt(0)}
            </div>
            <div>
              <CardTitle className="text-base">
                {provider.displayName}
                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                  / {provider.type}
                </span>
              </CardTitle>
              {provider.defaultModel && (() => {
                const configuredModelMeta = descriptor?.defaultModels.find(
                  (m) => m.name === provider.defaultModel,
                );
                return (
                  <CardDescription className="mt-0.5 text-xs flex items-center gap-1.5">
                    Default model: {provider.defaultModel}
                    {configuredModelMeta?.deprecated === true && (
                      <Badge variant="destructive" className="text-[10px]">Model deprecated</Badge>
                    )}
                  </CardDescription>
                );
              })()}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {provider.isDefault && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Star className="size-3" />
                Default
              </Badge>
            )}
            <Badge
              variant={isConfigured ? "success" : "outline"}
              className="text-xs"
            >
              {isConfigured ? (
                <>
                  <CheckCircle2 className="size-3" />
                  Configured
                </>
              ) : (
                <>
                  <Circle className="size-3" />
                  Not configured
                </>
              )}
            </Badge>

            {/* Live health badge, auto-polls every 60 s */}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant={healthVariant}
                    className="text-xs"
                    data-testid="health-badge"
                  >
                    {healthConfig.label}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent suppressHydrationWarning>
                  {health?.lastCheckAt
                    ? `Last checked ${formatRelativeTime(health.lastCheckAt)}`
                    : 'Checking…'}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Unhealthy error detail */}
        {healthStatus === 'unhealthy' && health?.lastError && (
          <Alert variant="destructive" className="py-2">
            <AlertDescription className="text-xs">{health.lastError}</AlertDescription>
          </Alert>
        )}

        {/* Masked credential chips, read-only display */}
        {provider.credentialsMasked &&
          Object.entries(provider.credentialsMasked).some(([, v]) => v !== "") && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(provider.credentialsMasked).map(([key, masked]) =>
                masked ? (
                  <Badge key={key} variant="outline" className="font-mono text-xs">
                    {key}: {masked}
                  </Badge>
                ) : null
              )}
            </div>
          )}
        {/* Fallback: legacy apiKeyMasked chip when credentialsMasked is absent */}
        {!provider.credentialsMasked && provider.apiKeyMasked && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {provider.apiKeyMasked}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-xs"
            disabled={testState === "testing"}
            onClick={onTestConnection}
          >
            {testState === "testing" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : testState === "ok" ? (
              <CheckCircle2 className="size-3 text-highlight" />
            ) : testState === "fail" ? (
              <WifiOff className="size-3 text-destructive" />
            ) : (
              <Plug className="size-3" />
            )}
            {testState === "testing"
              ? "Testing…"
              : testState === "ok"
                ? "Connected"
                : testState === "fail"
                  ? "Failed"
                  : "Test connection"}
          </Button>

          {!provider.isDefault && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-xs"
              disabled={isSettingDefault}
              onClick={onSetDefault}
            >
              {isSettingDefault && <Loader2 className="size-3 animate-spin" />}
              Set as default
            </Button>
          )}

          {descriptor && (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setEditOpen(true)}
              >
                <Pencil className="size-3" />
                Edit credentials
              </Button>
              <Dialog open={editOpen} onOpenChange={(open) => { setEditOpen(open); if (!open) setEditProbeResult(null); }}>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle className="text-sm">
                      Edit {provider.displayName} credentials
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Leave secret fields blank to keep the existing stored value.
                    </DialogDescription>
                  </DialogHeader>
                  <CredentialsAndTest
                    descriptor={descriptor}
                    providerName={provider.name}
                    secretFieldPlaceholder="Leave blank to keep existing value"
                    onValuesChange={(vals) => setEditCredentials(vals.credentials)}
                    onTest={runEditTest}
                    isTestPending={isEditTestPending}
                    probeResult={editProbeResult}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditOpen(false)}
                      disabled={isUpdating}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={onSaveCredentials}
                      disabled={isUpdating}
                      className="text-xs"
                    >
                      {isUpdating && <Loader2 className="size-3 animate-spin" />}
                      Save
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-xs text-destructive hover:text-destructive"
            disabled={isDeleting}
            onClick={onDelete}
          >
            {isDeleting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Trash2 className="size-3" />
            )}
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function ProviderCardSkeleton() {
  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48" />
            </div>
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-7 w-28 rounded-md" />
          <Skeleton className="h-7 w-24 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// ProvidersContent (page-level component)
// ---------------------------------------------------------------------------

export function ProvidersContent() {
  const queryClient = useQueryClient();
  const { data: supported, isLoading: isSupportedLoading } = useSupportedProviders();
  const { data, isLoading: isProvidersLoading, isError, error } = useProviders({
    includeDisabled: true,
    includeHealth: true,
  });
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const isLoading = isSupportedLoading || isProvidersLoading;
  const providers = data?.providers ?? [];
  const isEmpty = !isLoading && !isError && providers.length === 0;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: providerQueryKeys.lists() });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">LLM Providers</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Configure API credentials for LLM providers. Zero Root AI resolves the active provider
            at runtime based on agent slot requirements. Credentials are encrypted at rest by the
            daemon, they never persist in the dashboard.
          </p>
        </div>
        {!isLoading && providers.length > 0 && (
          <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-xs">
                Add Provider
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-sm">Add LLM Provider</DialogTitle>
                <DialogDescription className="text-xs">
                  Pick a provider, enter your credentials, and Gibson will pull
                  the live model list from the provider&apos;s API for you to
                  choose from.
                </DialogDescription>
              </DialogHeader>
              <ProviderWizard
                supported={supported ?? []}
                onComplete={() => {
                  setWizardOpen(false);
                  refresh();
                }}
                onCancel={() => setWizardOpen(false)}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            {error?.message ?? "Failed to load providers. Check daemon connectivity."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4">
        {isLoading ? (
          <>
            <ProviderCardSkeleton />
            <ProviderCardSkeleton />
          </>
        ) : isEmpty ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Connect your first provider</CardTitle>
              <CardDescription className="text-xs">
                Gibson agents call into your LLM via configured providers.
                You&apos;ll need at least one, pick a vendor below, paste your
                key, and Gibson will pull the available models for you to
                choose a default.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProviderWizard
                supported={supported ?? []}
                onComplete={refresh}
              />
            </CardContent>
          </Card>
        ) : (
          providers.map((provider) => (
            <ConfiguredProviderRow
              key={provider.name}
              provider={provider}
              descriptor={supported?.find((d) => d.type === provider.type)}
            />
          ))
        )}
      </div>
    </div>
  );
}
