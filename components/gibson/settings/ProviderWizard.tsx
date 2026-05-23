"use client";

/**
 * ProviderWizard
 *
 * Three-step flow for adding an LLM provider:
 *
 *   1. Pick provider type    — descriptors come from the daemon's
 *                              GetSupportedProviders RPC.
 *   2. Enter credentials +   — fields rendered from the descriptor's
 *      Test connection         CredentialField list. "Test" hits the daemon
 *                              TestProvider RPC, which returns the live model
 *                              catalogue from the provider's API on success.
 *   3. Pick a default model  — populated from the live test result; falls back
 *      and save                to the descriptor's static defaultModels for
 *                              providers (e.g. Bedrock) where the daemon
 *                              already knows the catalogue.
 *
 * The same component drives the empty-state first-run flow AND the
 * "Add Provider" dialog for subsequent providers — the only difference is
 * the surrounding chrome (full panel vs. dialog).
 *
 * Spec: providers-wizard.
 */

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Plug,
  Sparkles,
  WifiOff,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";

import { useCreateProvider } from "@/src/hooks/useProviderMutations";
import {
  CREDENTIAL_FIELD_TYPE,
  type CredentialFieldDescriptor,
  type SupportedProviderDescriptor,
} from "@/src/lib/gibson-client-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FoundModel {
  name: string;
  family: string;
  contextWindow: number;
}

interface ProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
  models: FoundModel[];
}

interface CredentialFormValues {
  name: string;
  credentials: Record<string, string>;
}

export interface ProviderWizardProps {
  supported: SupportedProviderDescriptor[];
  /** Called when the user's provider is successfully created. */
  onComplete?: () => void;
  /** Initial provider type, when launching directly into step 2 (e.g. preselected from a card). */
  initialType?: string;
  /** Optional cancel button — present in the dialog form, absent in empty-state. */
  onCancel?: () => void;
}

// ---------------------------------------------------------------------------
// Region datalist values
// ---------------------------------------------------------------------------

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-south-1",
  "sa-east-1",
  "me-south-1",
  "af-south-1",
];

const GCP_REGIONS = [
  "us-central1",
  "us-east1",
  "us-east4",
  "us-west1",
  "us-west2",
  "us-west3",
  "us-west4",
  "northamerica-northeast1",
  "southamerica-east1",
  "europe-west1",
  "europe-west2",
  "europe-west3",
  "europe-west4",
  "europe-west6",
  "europe-north1",
  "asia-east1",
  "asia-east2",
  "asia-northeast1",
  "asia-northeast2",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
];

// ---------------------------------------------------------------------------
// CredentialInput — dispatches to the right input widget by field type
// ---------------------------------------------------------------------------

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  value?: string;
};

function CredentialInput({
  cf,
  field,
  id,
}: {
  cf: CredentialFieldDescriptor;
  field: FieldProps;
  /** Forwarded from FormControl's Slot so the input gets the form item id for label association. */
  id?: string;
}) {
  const rawFieldType = cf.fieldType ?? CREDENTIAL_FIELD_TYPE.UNSPECIFIED;
  const effectiveType =
    rawFieldType !== CREDENTIAL_FIELD_TYPE.UNSPECIFIED
      ? rawFieldType
      : cf.secret
        ? CREDENTIAL_FIELD_TYPE.PASSWORD
        : CREDENTIAL_FIELD_TYPE.TEXT;

  if (effectiveType === CREDENTIAL_FIELD_TYPE.BOOL) {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={cf.key}
          checked={field.value === "true"}
          onCheckedChange={(checked) => {
            field.onChange({
              target: { value: checked ? "true" : "false" },
            } as React.ChangeEvent<HTMLInputElement>);
          }}
        />
        <label htmlFor={cf.key} className="cursor-pointer text-xs">
          {cf.label}
        </label>
      </div>
    );
  }

  if (effectiveType === CREDENTIAL_FIELD_TYPE.REGION) {
    const listId = `${cf.key}-regions`;
    return (
      <>
        <Input
          {...field}
          id={id}
          type="text"
          list={listId}
          placeholder={cf.placeholder || undefined}
          className="font-mono text-xs"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <datalist id={listId}>
          {AWS_REGIONS.map((r) => (
            <option key={r} value={r} />
          ))}
          {GCP_REGIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </>
    );
  }

  if (effectiveType === CREDENTIAL_FIELD_TYPE.URL) {
    return (
      <Input
        {...field}
        id={id}
        type="url"
        placeholder={cf.placeholder || undefined}
        className="font-mono text-xs"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
      />
    );
  }

  // TEXT or PASSWORD
  return (
    <Input
      {...field}
      id={id}
      type={effectiveType === CREDENTIAL_FIELD_TYPE.PASSWORD ? "password" : "text"}
      placeholder={cf.placeholder || undefined}
      className="font-mono text-xs"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 1: provider type picker
// ---------------------------------------------------------------------------

function ProviderTypePicker({
  supported,
  onPick,
}: {
  supported: SupportedProviderDescriptor[];
  onPick: (type: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {supported.map((d) => (
        <Card
          key={d.type}
          role="button"
          tabIndex={0}
          onClick={() => onPick(d.type)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPick(d.type);
            }
          }}
          className="hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors"
        >
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">{d.displayName}</CardTitle>
              {d.selfHosted && (
                <Badge variant="secondary" className="text-[10px]">
                  self-hosted
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              {d.credentials.length === 0
                ? "No credentials required"
                : `${d.credentials.length} credential field${d.credentials.length === 1 ? "" : "s"}`}
            </CardDescription>
            {d.type === "openai" && (
              <p className="text-muted-foreground mt-1 text-xs">
                Also works with Azure OpenAI, Ask Sage, and other compatible providers.
              </p>
            )}
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IrsaAwareCredentialFields — descriptor-driven field list with bool/checkbox
// rendering and IRSA-based hidden-field logic.
// ---------------------------------------------------------------------------

/**
 * Renders the credential fields for a provider descriptor.
 *
 * Bool-typed fields (fieldType === 'BOOL') render as a Checkbox. When a field
 * named `use_irsa` is checked, any sibling field that is both secret AND
 * optional is hidden from the form (but its default empty value is still
 * present in the form state so the daemon receives `key: ""` on submit — it
 * needs that to understand the field was intentionally left blank).
 *
 * Hiding logic is generic: it applies whenever a descriptor contains a
 * `use_irsa` bool field AND a secret+optional field in the same list.
 */
function IrsaAwareCredentialFields({
  descriptor,
  control,
  secretFieldPlaceholder,
}: {
  descriptor: SupportedProviderDescriptor;
  control: Control<CredentialFormValues>;
  secretFieldPlaceholder?: string;
}) {
  const hasIrsaToggle = descriptor.credentials.some((c) => c.key === 'use_irsa');
  // useWatch re-renders only when this field changes (efficient subscription).
  const irsaValue = useWatch({ control, name: 'credentials.use_irsa' });
  const usesIrsa = hasIrsaToggle && irsaValue === 'true';

  return (
    <>
      {descriptor.credentials.map((cf) => {
        const isBool = cf.fieldType === CREDENTIAL_FIELD_TYPE.BOOL;

        // Hide secret+optional fields when IRSA is active.
        if (usesIrsa && !isBool && cf.secret && !cf.required) {
          return null;
        }

        return (
          <FormField
            key={cf.key}
            control={control}
            name={`credentials.${cf.key}`}
            rules={{ required: cf.required && !cf.secret && !isBool ? `${cf.label} is required` : false }}
            render={({ field }) => (
              <FormItem>
                {isBool ? (
                  // Bool field → Checkbox layout.
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={cf.key}
                        checked={field.value === 'true'}
                        onCheckedChange={(checked) =>
                          field.onChange(checked ? 'true' : 'false')
                        }
                      />
                      <label
                        htmlFor={cf.key}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {cf.label}
                      </label>
                    </div>
                    {field.value === 'true' && cf.key === 'use_irsa' && (
                      <p className="text-muted-foreground text-xs">
                        The daemon will use the EKS service-account IAM role. No static keys needed.
                      </p>
                    )}
                    {cf.help && field.value !== 'true' && (
                      <FormDescription className="text-xs">{cf.help}</FormDescription>
                    )}
                  </div>
                ) : (
                  // Text / password / URL / REGION → CredentialInput dispatches by fieldType.
                  <>
                    <FormLabel className="text-xs">
                      {cf.label}
                      {cf.required && (
                        <span className="text-destructive ml-1" aria-label="required">
                          *
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <CredentialInput
                        cf={cf.secret && secretFieldPlaceholder ? { ...cf, placeholder: secretFieldPlaceholder } : cf}
                        field={field as FieldProps}
                      />
                    </FormControl>
                    {cf.help && (
                      <FormDescription className="text-xs">{cf.help}</FormDescription>
                    )}
                    <FormMessage />
                  </>
                )}
              </FormItem>
            )}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Step 2: credentials + test connection
// ---------------------------------------------------------------------------

export function CredentialsAndTest({
  descriptor,
  formValues,
  setFormValues,
  probeResult,
  onTest,
  isTestPending,
}: {
  descriptor: SupportedProviderDescriptor;
  formValues: CredentialFormValues;
  setFormValues: (v: CredentialFormValues) => void;
  probeResult: ProbeResult | null;
  onTest: (values: CredentialFormValues) => void;
  isTestPending: boolean;
}) {
  // Seed defaultValues for every credential key so that hidden fields still
  // appear in the submitted payload with their zero-value ("" for text,
  // "false" for bool). react-hook-form only includes a field in the submit
  // payload if it was registered (i.e. rendered); by seeding the defaultValues
  // we ensure the zero-values are present even when a field is hidden.
  const seededCredentials: Record<string, string> = {};
  for (const cf of descriptor.credentials) {
    seededCredentials[cf.key] = formValues.credentials[cf.key] ??
      (cf.fieldType === CREDENTIAL_FIELD_TYPE.BOOL ? 'false' : '');
  }

  const form = useForm<CredentialFormValues>({
    defaultValues: {
      name: formValues.name,
      credentials: seededCredentials,
    },
    mode: "onChange",
  });

  // Keep the parent's state in sync — needed so the model picker on step 3
  // can read the credentials at "Save" time.
  React.useEffect(() => {
    const sub = form.watch((value) => {
      setFormValues({
        name: value.name ?? "",
        credentials: (value.credentials as Record<string, string>) ?? {},
      });
    });
    return () => sub.unsubscribe();
  }, [form, setFormValues]);

  function handleSubmit(values: CredentialFormValues) {
    onTest(values);
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
                  placeholder={`${descriptor.type}-prod`}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Unique name for this provider instance. Used to reference it from agent slots.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <IrsaAwareCredentialFields
          descriptor={descriptor}
          control={form.control}
        />

        {/* Probe result banner */}
        {probeResult && probeResult.ok && (
          <Alert>
            <CheckCircle2 className="size-4 text-highlight" />
            <AlertDescription className="text-xs">
              Connection verified ({probeResult.latencyMs} ms).{" "}
              {probeResult.models.length > 0 ? (
                <>Found {probeResult.models.length} model{probeResult.models.length === 1 ? "" : "s"}.</>
              ) : (
                "No live model list — using the provider's static catalogue."
              )}
            </AlertDescription>
          </Alert>
        )}
        {probeResult && !probeResult.ok && (
          <Alert variant="destructive">
            <WifiOff className="size-4" />
            <AlertDescription className="text-xs">
              {probeResult.error ?? "Connection failed."}
            </AlertDescription>
            {probeResult.error?.includes("allow_private_llm_endpoints") && (
              <p className="mt-2 text-xs">
                To allow private or on-premise endpoints, set{" "}
                <code className="font-mono">
                  security.allow_private_llm_endpoints = true
                </code>{" "}
                in your daemon configuration.
              </p>
            )}
          </Alert>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="text-xs"
            disabled={isTestPending}
          >
            {isTestPending ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plug className="size-3" />
            )}
            Test connection
          </Button>
          {!descriptor.selfHosted && (
            <p className="text-muted-foreground text-xs">
              Validates the credentials and pulls the live model list.
            </p>
          )}
        </div>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Step 3: model picker + save
// ---------------------------------------------------------------------------

function ModelPickerAndSave({
  descriptor,
  liveModels,
  pickedModel,
  setPickedModel,
  setAsDefault,
  setSetAsDefault,
  onSave,
  isSavePending,
}: {
  descriptor: SupportedProviderDescriptor;
  liveModels: FoundModel[];
  pickedModel: string;
  setPickedModel: (m: string) => void;
  setAsDefault: boolean;
  setSetAsDefault: (b: boolean) => void;
  onSave: () => void;
  isSavePending: boolean;
}) {
  // Prefer live models when present; otherwise fall back to the descriptor's
  // default catalogue (e.g. Bedrock has a static list, Anthropic does not).
  const models: FoundModel[] =
    liveModels.length > 0
      ? liveModels
      : descriptor.defaultModels.map((m) => ({
          name: m.name,
          family: m.family ?? "",
          contextWindow: m.contextWindow ?? 0,
        }));

  React.useEffect(() => {
    if (!pickedModel && models.length > 0) {
      setPickedModel(models[0].name);
    }
  }, [models, pickedModel, setPickedModel]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Default model</label>
        {models.length === 0 ? (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              The provider didn&apos;t return a model list. Type the model name
              manually below — Gibson will use it for new agent slots that
              reference this provider.
            </AlertDescription>
          </Alert>
        ) : (
          <Select value={pickedModel} onValueChange={setPickedModel}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m.name} value={m.name} className="font-mono text-xs">
                  <div className="flex items-baseline justify-between gap-3">
                    <span>{m.name}</span>
                    {m.contextWindow > 0 && (
                      <span className="text-muted-foreground text-[10px]">
                        {m.contextWindow.toLocaleString()} ctx
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {models.length === 0 && (
          <Input
            value={pickedModel}
            onChange={(e) => setPickedModel(e.target.value)}
            placeholder="model-name"
            className="font-mono text-xs"
          />
        )}
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={setAsDefault}
          onChange={(e) => setSetAsDefault(e.target.checked)}
        />
        Set as default provider for this workspace
      </label>

      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={isSavePending || !pickedModel}
        className="text-xs"
      >
        {isSavePending && <Loader2 className="size-3 animate-spin" />}
        Save provider
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level wizard
// ---------------------------------------------------------------------------

export function ProviderWizard({
  supported,
  onComplete,
  initialType = "",
  onCancel,
}: ProviderWizardProps) {
  const [selectedType, setSelectedType] = React.useState<string>(initialType);
  const [formValues, setFormValues] = React.useState<CredentialFormValues>({
    name: initialType,
    credentials: {},
  });
  const [probeResult, setProbeResult] = React.useState<ProbeResult | null>(null);
  const [pickedModel, setPickedModel] = React.useState<string>("");
  const [setAsDefault, setSetAsDefault] = React.useState<boolean>(false);
  const [isTestPending, setIsTestPending] = React.useState<boolean>(false);

  const createMutation = useCreateProvider();
  const descriptor = supported.find((d) => d.type === selectedType);

  // step: 1 = pick type, 2 = creds, 3 = model + save
  const step: 1 | 2 | 3 = !selectedType
    ? 1
    : probeResult?.ok
      ? 3
      : 2;

  function reset() {
    setSelectedType("");
    setFormValues({ name: "", credentials: {} });
    setProbeResult(null);
    setPickedModel("");
    setSetAsDefault(false);
  }

  function pickType(type: string) {
    setSelectedType(type);
    setFormValues({ name: type, credentials: {} });
    setProbeResult(null);
    setPickedModel("");
  }

  async function runTest(values: CredentialFormValues) {
    if (!descriptor) return;
    setIsTestPending(true);
    setProbeResult(null);
    try {
      const res = await fetch("/api/settings/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: descriptor.type,
          name: values.name,
          // The default model is populated AFTER the probe; for the test call
          // itself we send a single representative entry from the descriptor's
          // catalogue when one exists, otherwise the empty string. Providers
          // that ignore the model field on a health probe (most do) won't care.
          defaultModel: descriptor.defaultModels[0]?.name ?? "",
          credentials: values.credentials,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        result?: ProbeResult;
        error?: { message?: string };
      };
      if (!res.ok) {
        setProbeResult({
          ok: false,
          latencyMs: 0,
          error:
            body.error?.message ??
            `Test failed (HTTP ${res.status})`,
          models: [],
        });
        return;
      }
      const r = body.result;
      if (!r) {
        setProbeResult({
          ok: false,
          latencyMs: 0,
          error: "Daemon returned no result",
          models: [],
        });
        return;
      }
      setProbeResult({
        ok: r.ok,
        latencyMs: r.latencyMs ?? 0,
        error: r.error,
        models: r.models ?? [],
      });
    } catch (err) {
      setProbeResult({
        ok: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "Network error",
        models: [],
      });
    } finally {
      setIsTestPending(false);
    }
  }

  function save() {
    if (!descriptor) return;
    createMutation.mutate(
      {
        config: {
          type: descriptor.type,
          name: formValues.name,
          defaultModel: pickedModel,
          credentials: formValues.credentials,
          setAsDefault,
        },
      },
      {
        onSuccess: () => {
          toast.success(`${descriptor.displayName} connected`);
          reset();
          onComplete?.();
        },
        onError: (err) => {
          toast.error("Failed to save provider", {
            description: err.message,
          });
        },
      },
    );
  }

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        <StepDot active={step >= 1} done={step > 1} label="Choose" />
        <StepConnector />
        <StepDot active={step >= 2} done={step > 2} label="Connect" />
        <StepConnector />
        <StepDot active={step >= 3} done={false} label="Confirm" />
      </div>

      <Separator />

      {step === 1 && (
        <ProviderTypePicker supported={supported} onPick={pickType} />
      )}

      {step === 2 && descriptor && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="size-3.5" />
              <span className="text-sm font-medium">{descriptor.displayName}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={reset}
              className="text-xs"
            >
              <ChevronLeft className="size-3" />
              Choose a different provider
            </Button>
          </div>
          <CredentialsAndTest
            descriptor={descriptor}
            formValues={formValues}
            setFormValues={setFormValues}
            probeResult={probeResult}
            onTest={runTest}
            isTestPending={isTestPending}
          />
        </div>
      )}

      {step === 3 && descriptor && probeResult?.ok && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-3.5 text-highlight" />
              <span className="text-sm font-medium">
                {descriptor.displayName} verified
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setProbeResult(null)}
              className="text-xs"
            >
              <ChevronLeft className="size-3" />
              Edit credentials
            </Button>
          </div>
          <ModelPickerAndSave
            descriptor={descriptor}
            liveModels={probeResult.models}
            pickedModel={pickedModel}
            setPickedModel={setPickedModel}
            setAsDefault={setAsDefault}
            setSetAsDefault={setSetAsDefault}
            onSave={save}
            isSavePending={createMutation.isPending}
          />
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end pt-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="text-xs"
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

function StepDot({
  active,
  done,
  label,
}: {
  active: boolean;
  done: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={
          done
            ? "bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full"
            : active
              ? "border-primary text-primary flex size-5 items-center justify-center rounded-full border"
              : "border-muted-foreground/40 text-muted-foreground flex size-5 items-center justify-center rounded-full border"
        }
      >
        {done ? (
          <CheckCircle2 className="size-3" />
        ) : (
          <span className="text-[10px]">{active ? "•" : ""}</span>
        )}
      </div>
      <span className={active ? "font-medium" : "text-muted-foreground"}>
        {label}
      </span>
    </div>
  );
}

function StepConnector() {
  return <div className="bg-muted-foreground/30 h-px w-6" />;
}
