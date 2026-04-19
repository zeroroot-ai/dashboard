"use client";

/**
 * ProvidersContent
 *
 * Descriptor-driven LLM provider configuration panel for Gibson settings.
 *
 * The form renders whatever credential fields the daemon's GetSupportedProviders
 * RPC descriptor returns for the selected provider type — no hard-coded
 * per-provider configuration. Adding a new daemon provider automatically
 * surfaces in the dropdown and form without a dashboard code change.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, Circle, Loader2, Plug, Star, Trash2, WifiOff } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

import { useSupportedProviders } from "@/src/hooks/useSupportedProviders";
import { useProviders } from "@/src/hooks/useProviders";
import { useCreateProvider, useDeleteProvider, useSetDefaultProvider } from "@/src/hooks/useProviderMutations";
import type { SupportedProviderDescriptor } from "@/src/lib/gibson-client";
import type { ProviderConfig } from "@/src/types/provider";

// ---------------------------------------------------------------------------
// DynamicCredentialForm
// ---------------------------------------------------------------------------

/**
 * Form values shape — credentials keyed by field.key plus display fields.
 * Using Record<string, string> keeps the form agnostic to provider type.
 */
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
        {/* Provider instance name */}
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
        {descriptor.credentials.map((field) => (
          <FormField
            key={field.key}
            control={form.control}
            name={`credentials.${field.key}`}
            rules={{ required: field.required ? `${field.label} is required` : false }}
            render={({ field: formField }) => (
              <FormItem>
                <FormLabel className="text-xs">
                  {field.label}
                  {field.required && (
                    <span className="text-destructive ml-1" aria-label="required">
                      *
                    </span>
                  )}
                </FormLabel>
                <FormControl>
                  {/*
                   * Password inputs are uncontrolled via ref forwarding inside
                   * react-hook-form. The value is read from the DOM on submit
                   * via form.handleSubmit — React never stores the plaintext
                   * in component state beyond that single submit handler call.
                   */}
                  <Input
                    {...formField}
                    type={field.secret ? "password" : "text"}
                    placeholder={field.placeholder || undefined}
                    className="font-mono text-xs"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </FormControl>
                {field.help && (
                  <FormDescription className="text-xs">{field.help}</FormDescription>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        ))}

        {/* Default model selection */}
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

// ---------------------------------------------------------------------------
// AddProviderDialog
// ---------------------------------------------------------------------------

interface AddProviderDialogProps {
  supported: SupportedProviderDescriptor[];
}

function AddProviderDialog({ supported }: AddProviderDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [selectedType, setSelectedType] = React.useState<string>("");

  const descriptor = supported.find((d) => d.type === selectedType);
  const createMutation = useCreateProvider();

  function handleTypeChange(type: string) {
    setSelectedType(type);
  }

  function handleSubmit(values: DynamicFormValues) {
    const payload = {
      type: selectedType,
      name: values.name,
      defaultModel: values.defaultModel,
      credentials: values.credentials,
      setAsDefault: values.setAsDefault,
    };

    createMutation.mutate(
      { config: { type: payload.type, name: payload.name, defaultModel: payload.defaultModel, credentials: payload.credentials, setAsDefault: payload.setAsDefault } },
      {
        onSuccess: () => {
          toast.success(`${descriptor?.displayName ?? selectedType} provider added`);
          setOpen(false);
          setSelectedType("");
        },
        onError: (err) => {
          toast.error(`Failed to add provider`, {
            description: err.message,
          });
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="text-xs">
          Add Provider
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Add LLM Provider</DialogTitle>
          <DialogDescription className="text-xs">
            Configure credentials for an LLM provider. Credentials are encrypted at rest by the
            daemon — they never persist in the dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Provider type selector */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Provider Type</label>
            <Select value={selectedType} onValueChange={handleTypeChange}>
              <SelectTrigger className="w-full text-xs" data-testid="provider-type-select">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {supported.map((d) => (
                  <SelectItem key={d.type} value={d.type} className="text-xs">
                    {d.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Credential form rendered from the selected descriptor */}
          {descriptor && (
            <DynamicCredentialForm
              descriptor={descriptor}
              onSubmit={handleSubmit}
              isPending={createMutation.isPending}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ConfiguredProviderRow
// ---------------------------------------------------------------------------

interface ConfiguredProviderRowProps {
  provider: ProviderConfig;
}

function ConfiguredProviderRow({ provider }: ConfiguredProviderRowProps) {
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "fail">("idle");

  const { mutate: deleteProvider, isPending: isDeleting } = useDeleteProvider();
  const { mutate: setDefault, isPending: isSettingDefault } = useSetDefaultProvider();

  const isConfigured = provider.isEnabled && !!provider.apiKeyMasked;

  async function onTestConnection() {
    setTestState("testing");
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: provider.name }),
      });
      const result = await res.json();
      if (result.ok ?? result.success) {
        setTestState("ok");
        toast.success(`${provider.displayName} connection verified`, {
          description: result.latencyMs ? `${result.latencyMs} ms` : undefined,
        });
      } else {
        setTestState("fail");
        toast.error(`Connection to ${provider.displayName} failed`, {
          description: result.error ?? "Unknown error",
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
              {provider.defaultModel && (
                <CardDescription className="mt-0.5 text-xs">
                  Default model: {provider.defaultModel}
                </CardDescription>
              )}
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
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Masked credential chips — read-only display */}
        {provider.apiKeyMasked && (
          <div className="flex flex-wrap gap-2">
            <div className="border-border/40 bg-muted/30 inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-xs">
              <span className="text-muted-foreground">api_key</span>
              <span>{provider.apiKeyMasked}</span>
            </div>
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
              <CheckCircle2 className="size-3 text-green-500" />
            ) : testState === "fail" ? (
              <WifiOff className="size-3 text-destructive" />
            ) : (
              <Plug className="size-3" />
            )}
            {testState === "testing"
              ? "Testing\u2026"
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
  const { data: supported, isLoading: isSupportedLoading } = useSupportedProviders();
  const { data, isLoading: isProvidersLoading, isError, error } = useProviders({
    includeDisabled: true,
    includeHealth: true,
  });

  const isLoading = isSupportedLoading || isProvidersLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">LLM Providers</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Configure API credentials for LLM providers. Zero Day AI resolves the active provider
            at runtime based on agent slot requirements. Credentials are encrypted at rest by the
            daemon — they never persist in the dashboard.
          </p>
        </div>
        {!isLoading && (
          <AddProviderDialog supported={supported ?? []} />
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
        ) : (
          <>
            {(data?.providers ?? []).length === 0 && (
              <Alert>
                <AlertCircle className="size-4" />
                <AlertDescription className="text-xs">
                  No providers configured yet. Click &ldquo;Add Provider&rdquo; to get started.
                </AlertDescription>
              </Alert>
            )}
            {(data?.providers ?? []).map((provider) => (
              <ConfiguredProviderRow key={provider.name} provider={provider} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
