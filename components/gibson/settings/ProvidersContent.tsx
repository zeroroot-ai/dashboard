"use client";

/**
 * ProvidersContent
 * LLM provider configuration panel for Gibson settings.
 */

import * as React from "react";
import { AlertCircle, CheckCircle2, Circle, Eye, EyeOff, Loader2, Plug, WifiOff } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useForm } from "react-hook-form";

import { useProviders } from "@/src/hooks/useProviders";
import { useCreateProvider, useUpdateProvider } from "@/src/hooks/useProviderMutations";
import { testProviderConnection } from "@/src/lib/api/providers";
import { PROVIDER_MODELS, PROVIDER_TYPE_CONFIG, PROVIDER_TYPES } from "@/src/types/provider";
import type { ProviderConfig, ProviderType } from "@/src/types/provider";

// ---------------------------------------------------------------------------
// Per-provider model lists derived from PROVIDER_MODELS constant
// ---------------------------------------------------------------------------

function modelsForType(type: ProviderType): string[] {
  return (PROVIDER_MODELS[type] ?? []).map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ProviderFormValues {
  apiKey: string;
  model: string;
}

function ProviderCard({ provider }: { provider: ProviderConfig }) {
  const [showKey, setShowKey] = React.useState(false);
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "fail">("idle");

  const { mutate: updateProvider, isPending: isSaving } = useUpdateProvider();

  const typeConfig = PROVIDER_TYPE_CONFIG[provider.type];
  const models = modelsForType(provider.type);
  const isOllama = provider.type === "ollama";

  const form = useForm<ProviderFormValues>({
    defaultValues: {
      apiKey: provider.apiKeyMasked ?? "",
      model: provider.defaultModel ?? models[0] ?? "",
    },
  });

  function onSave(values: ProviderFormValues) {
    const updatePayload: Record<string, unknown> = {
      defaultModel: values.model,
    };

    // Only send apiKey if the user actually typed a new one (not the masked placeholder)
    if (values.apiKey && values.apiKey !== provider.apiKeyMasked) {
      if (isOllama) {
        updatePayload.baseUrl = values.apiKey;
      } else {
        updatePayload.apiKey = values.apiKey;
      }
    }

    updateProvider(
      {
        name: provider.name,
        config: updatePayload as Parameters<typeof updateProvider>[0]["config"],
        expectedVersion: provider.version,
      },
      {
        onSuccess: () => {
          toast.success(`${provider.displayName} settings saved`);
        },
        onError: (err) => {
          toast.error(`Failed to save ${provider.displayName}`, {
            description: err.message,
          });
        },
      }
    );
  }

  async function onTestConnection() {
    setTestState("testing");
    try {
      const result = await testProviderConnection(provider.name);
      if (result.success) {
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

  const isConfigured = provider.isEnabled && !!provider.apiKeyMasked;

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="border-border/60 bg-muted/40 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-semibold">
              {typeConfig?.label?.charAt(0) ?? provider.displayName.charAt(0)}
            </div>
            <div>
              <CardTitle className="text-base">
                {provider.displayName}
                <span className="text-muted-foreground ml-1.5 text-sm font-normal">
                  / {typeConfig?.label ?? provider.type}
                </span>
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {typeConfig?.description ?? ""}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={isConfigured ? "success" : "outline"}
            className="shrink-0 text-xs"
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
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">
                    {isOllama ? "Base URL" : "API Key"}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={isOllama ? "text" : showKey ? "text" : "password"}
                        placeholder={
                          isOllama
                            ? "http://localhost:11434"
                            : provider.apiKeyMasked ?? "Paste API key…"
                        }
                        className="font-mono text-xs pr-9"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      {!isOllama && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowKey((v) => !v)}
                          aria-label={showKey ? "Hide key" : "Show key"}
                        >
                          {showKey ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription className="text-xs">
                    {isOllama
                      ? "URL of your local Ollama instance."
                      : "Stored encrypted at rest. Never logged."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {models.length > 0 && (
              <FormField
                control={form.control}
                name="model"
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
                        {models.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-xs">
                            {m}
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
                disabled={isSaving}
              >
                {isSaving && <Loader2 className="size-3 animate-spin" />}
                Save
              </Button>
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
                  ? "Testing…"
                  : testState === "ok"
                    ? "Connected"
                    : testState === "fail"
                      ? "Failed"
                      : "Test connection"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * Card for a provider type that hasn't been configured yet.
 * Shows the provider info and a form to enter credentials and create it.
 */
function UnconfiguredProviderCard({ type }: { type: ProviderType }) {
  const [showKey, setShowKey] = React.useState(false);
  const [testState, setTestState] = React.useState<"idle" | "testing" | "ok" | "fail">("idle");

  const { mutate: createProviderMutation, isPending: isSaving } = useCreateProvider();

  const typeConfig = PROVIDER_TYPE_CONFIG[type];
  const models = modelsForType(type);
  const isOllama = type === "ollama";

  const form = useForm<ProviderFormValues>({
    defaultValues: {
      apiKey: "",
      model: models[0] ?? "",
    },
  });

  function onSave(values: ProviderFormValues) {
    if (!values.apiKey && !isOllama) return;

    createProviderMutation(
      {
        config: {
          name: type,
          displayName: typeConfig.label,
          type,
          ...(isOllama
            ? { baseUrl: values.apiKey || "http://localhost:11434" }
            : { apiKey: values.apiKey }),
          defaultModel: values.model,
          isEnabled: true,
        },
      },
      {
        onSuccess: () => {
          toast.success(`${typeConfig.label} configured successfully`);
        },
        onError: (err) => {
          toast.error(`Failed to configure ${typeConfig.label}`, {
            description: err.message,
          });
        },
      }
    );
  }

  async function onTestConnection() {
    const apiKey = form.getValues("apiKey");
    if (!apiKey && !isOllama) {
      toast.error("Enter an API key first");
      return;
    }
    setTestState("testing");
    try {
      // Test with ad-hoc config (not yet saved)
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            type,
            ...(isOllama
              ? { baseUrl: apiKey || "http://localhost:11434" }
              : { apiKey }),
            defaultModel: form.getValues("model"),
          },
        }),
      });
      const result = await res.json();
      if (result.success) {
        setTestState("ok");
        toast.success(`${typeConfig.label} connection verified`, {
          description: result.latencyMs ? `${result.latencyMs} ms` : undefined,
        });
      } else {
        setTestState("fail");
        toast.error(`Connection to ${typeConfig.label} failed`, {
          description: result.error ?? "Unknown error",
        });
      }
    } catch (err) {
      setTestState("fail");
      toast.error(`Connection to ${typeConfig.label} failed`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="border-border/60 bg-muted/40 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-semibold">
              {typeConfig.label.charAt(0)}
            </div>
            <div>
              <CardTitle className="text-base">
                {typeConfig.label}
              </CardTitle>
              <CardDescription className="mt-0.5 text-xs">
                {typeConfig.description}
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            <Circle className="size-3" />
            Not configured
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">
                    {isOllama ? "Base URL" : "API Key"}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Input
                        {...field}
                        type={isOllama ? "text" : showKey ? "text" : "password"}
                        placeholder={
                          isOllama
                            ? "http://localhost:11434"
                            : "Paste API key\u2026"
                        }
                        className="font-mono text-xs pr-9"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                      {!isOllama && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="absolute right-0 top-0 h-full w-9 text-muted-foreground hover:text-foreground"
                          onClick={() => setShowKey((v) => !v)}
                          aria-label={showKey ? "Hide key" : "Show key"}
                        >
                          {showKey ? (
                            <EyeOff className="size-3.5" />
                          ) : (
                            <Eye className="size-3.5" />
                          )}
                        </Button>
                      )}
                    </div>
                  </FormControl>
                  <FormDescription className="text-xs">
                    {isOllama
                      ? "URL of your local Ollama instance."
                      : "Stored encrypted at rest. Never logged."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {models.length > 0 && (
              <FormField
                control={form.control}
                name="model"
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
                        {models.map((m) => (
                          <SelectItem key={m} value={m} className="font-mono text-xs">
                            {m}
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
                disabled={isSaving}
              >
                {isSaving && <Loader2 className="size-3 animate-spin" />}
                Configure
              </Button>
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
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

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
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-7 w-14 rounded-md" />
          <Skeleton className="h-7 w-28 rounded-md" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function ProvidersContent() {
  const { data, isLoading, isError, error } = useProviders({
    includeDisabled: true,
    includeHealth: true,
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">LLM Providers</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Configure API credentials for LLM providers. Zero Day AI resolves the active provider at
          runtime based on agent slot requirements.
        </p>
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
            <ProviderCardSkeleton />
          </>
        ) : (
          <>
            {/* Configured providers */}
            {(data?.providers ?? []).map((provider) => (
              <ProviderCard key={provider.name} provider={provider} />
            ))}
            {/* Unconfigured provider types */}
            {(() => {
              const configuredTypes = new Set(
                (data?.providers ?? []).map((p) => p.type)
              );
              const unconfigured = PROVIDER_TYPES.filter(
                (t) => !configuredTypes.has(t)
              );
              return unconfigured.map((type) => (
                <UnconfiguredProviderCard key={type} type={type} />
              ));
            })()}
          </>
        )}
      </div>
    </div>
  );
}
