// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * ProviderWizard
 *
 * Three-step flow for adding an LLM provider (gibson#1394). The wizard SAVES
 * the provider first and tests it after. No call sends a credential that is
 * not saved.
 *
 *   1. Pick provider type   , descriptors come from the daemon's
 *                              GetSupportedProviders RPC. Only a type that
 *                              the model gateway routes is offered.
 *   2. Enter credentials,   , fields rendered from the descriptor's
 *      model and context       CredentialField list. The name must be a valid
 *      window, then save       Kubernetes name. A chat model needs a stated
 *                              context window. Save calls CreateProvider.
 *   3. Test the saved       , the route of the provider on the model gateway
 *      provider                is made after the save. The panel waits for it,
 *                              then tests. A failed test leaves the saved
 *                              provider, which the person can edit or remove.
 *
 * The same component drives the empty-state first-run flow AND the
 * "Add Provider" dialog for subsequent providers, the only difference is
 * the surrounding chrome (full panel vs. dialog).
 */

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, ChevronLeft, Loader2, Sparkles } from "lucide-react";

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
import { RevealableInput } from "@/components/ui/revealable-input";
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
  type ProviderCapability,
} from "@/src/lib/gibson-client-types";
import {
  PROVIDER_CAPABILITIES,
  capabilityLabel,
  isEmbeddingOnlyProviderType,
  defaultCapabilitiesForType,
  selectableCapabilitiesForType,
} from "@/src/lib/provider-capabilities";
import { isOfferedProviderType } from "@/src/lib/providers/offered-types";
import { PROVIDER_NAME_MAX_LENGTH, providerNameError } from "@/src/lib/providers/provider-name";
import { EditCredentialsDialog } from "./EditCredentialsDialog";
import { ProviderTestPanel } from "./ProviderTestPanel";
import { Textarea } from "@/components/ui/textarea";
import { loginShapeHint } from "@/src/lib/providers/login-shape";
import { isSecretDocumentField, validateSecretDocument } from "@/src/lib/providers/secret-document";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FoundModel {
  name: string;
  family: string;
  contextWindow: number;
  /** What the model can do, when the provider reports it (dashboard#311). */
  capabilities?: ProviderCapability[];
}

interface CredentialFormValues {
  name: string;
  credentials: Record<string, string>;
}

interface ProviderWizardProps {
  supported: SupportedProviderDescriptor[];
  /** Called when the user's provider is successfully created. */
  onComplete?: () => void;
  /** Initial provider type, when launching directly into step 2 (e.g. preselected from a card). */
  initialType?: string;
  /** Optional cancel button, present in the dialog form, absent in empty-state. */
  onCancel?: () => void;
  /**
   * Preselect the "set as default" checkbox. The parent passes true when the
   * tenant has no default provider yet, so the first provider a tenant adds
   * becomes the default without a second step. With no default provider the
   * chat, the mission-create form and a bank all report "no provider
   * configured" even though one exists.
   */
  preselectDefault?: boolean;
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
// CredentialInput, dispatches to the right input widget by field type
// ---------------------------------------------------------------------------

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  value?: string;
};

function CredentialInput({
  cf,
  field,
  id,
  secretFieldPlaceholder,
}: {
  cf: CredentialFieldDescriptor;
  field: FieldProps;
  /** Forwarded from FormControl's Slot so the input gets the form item id for label association. */
  id?: string;
  /** Override placeholder for secret fields (e.g. edit-dialog mode). */
  secretFieldPlaceholder?: string;
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

  // A whole secret document (a service-account key): a multi-line box. The
  // value is write-only like every secret field; the shape check runs in the
  // form rules (see IrsaAwareCredentialFields). gibson#1706 lane E6.
  if (isSecretDocumentField(cf)) {
    // react-hook-form's field carries a ref for focus-on-error; FieldProps
    // types it away because it targets an <input>. Forward it with the rest.
    const { onChange, onBlur, value, name, ref } = field as typeof field & {
      ref?: React.Ref<HTMLTextAreaElement>;
    };
    return (
      <Textarea
        id={id}
        name={name}
        ref={ref}
        value={value ?? ""}
        onChange={onChange as unknown as React.ChangeEventHandler<HTMLTextAreaElement>}
        onBlur={onBlur as unknown as React.FocusEventHandler<HTMLTextAreaElement>}
        rows={6}
        placeholder={secretFieldPlaceholder ?? (cf.placeholder || "Paste the full JSON key file")}
        className="font-mono text-xs"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        data-testid={`secret-document-${cf.key}`}
      />
    );
  }

  // TEXT or PASSWORD
  const isPassword = effectiveType === CREDENTIAL_FIELD_TYPE.PASSWORD;
  const placeholder =
    isPassword && secretFieldPlaceholder
      ? secretFieldPlaceholder
      : (cf.placeholder || undefined);
  return (
    <RevealableInput
      {...field}
      id={id}
      type={isPassword ? "password" : "text"}
      placeholder={placeholder}
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
      {supported.map((d) => {
        const embeddingOnly = isEmbeddingOnlyProviderType(d.type);
        return (
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
                <div className="flex items-center gap-1">
                  {embeddingOnly && (
                    <Badge variant="secondary" className="text-[10px]">
                      embeddings
                    </Badge>
                  )}
                  {d.selfHosted && (
                    <Badge variant="secondary" className="text-[10px]">
                      self-hosted
                    </Badge>
                  )}
                </div>
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
              {loginShapeHint(d.type) && (
                <p className="text-muted-foreground mt-1 text-xs" data-testid={`login-shape-hint-${d.type}`}>
                  {loginShapeHint(d.type)}
                </p>
              )}
            </CardHeader>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IrsaAwareCredentialFields, descriptor-driven field list with bool/checkbox
// rendering and IRSA-based hidden-field logic.
// ---------------------------------------------------------------------------

/**
 * Renders the credential fields for a provider descriptor.
 *
 * Bool-typed fields (fieldType === 'BOOL') render as a Checkbox. When a field
 * named `use_irsa` is checked, any sibling field that is both secret AND
 * optional is hidden from the form (but its default empty value is still
 * present in the form state so the daemon receives `key: ""` on submit, it
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
            rules={{
              required: cf.required && !cf.secret && !isBool ? `${cf.label} is required` : false,
              validate: isSecretDocumentField(cf) ? validateSecretDocument : undefined,
            }}
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
// Step 2: credentials (the test runs after the save)
// ---------------------------------------------------------------------------

interface CredentialsFormProps {
  descriptor: SupportedProviderDescriptor;

  // Wizard-mode props (used by ProviderWizard)
  formValues?: CredentialFormValues;
  setFormValues?: (v: CredentialFormValues) => void;

  // Edit-dialog-mode props (used by ConfiguredProviderRow edit dialog)
  /** Pre-populate non-secret fields (secret fields always start blank). */
  initialValues?: Record<string, string>;
  /** Placeholder text for secret inputs, e.g. "Leave blank to keep existing value". */
  secretFieldPlaceholder?: string;
  /** Called after every form-value change, lets the parent read current values. */
  onValuesChange?: (values: CredentialFormValues) => void;
  /** Override the provider name shown in the form's Name field (edit mode). */
  providerName?: string;
}

/**
 * The name and the credential fields of a provider. The form has no test
 * button: a provider is tested after it is saved (gibson#1394). The parent
 * reads the values through setFormValues or onValuesChange.
 */
export function CredentialsForm({
  descriptor,
  formValues: externalFormValues,
  setFormValues,
  initialValues,
  secretFieldPlaceholder,
  onValuesChange,
  providerName,
}: CredentialsFormProps) {
  // Build default values: non-secret fields pre-populated from initialValues;
  // secret fields always start blank (user must re-enter to change).
  const defaultCredentials: Record<string, string> = {};
  for (const cf of descriptor.credentials) {
    defaultCredentials[cf.key] = !cf.secret ? (initialValues?.[cf.key] ?? "") : "";
  }

  const form = useForm<CredentialFormValues>({
    defaultValues: externalFormValues ?? {
      name: providerName ?? descriptor.type,
      credentials: defaultCredentials,
    },
    mode: "onChange",
  });

  // Keep the parent's state in sync, needed so the save button can read the
  // credentials.
  React.useEffect(() => {
    const sub = form.watch((value) => {
      const vals: CredentialFormValues = {
        name: value.name ?? "",
        credentials: (value.credentials as Record<string, string>) ?? {},
      };
      setFormValues?.(vals);
      onValuesChange?.(vals);
    });
    return () => sub.unsubscribe();
  }, [form, setFormValues, onValuesChange]);

  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
        {/* Name field: shown only in wizard (create) mode */}
        {!providerName && (
        <FormField
          control={form.control}
          name="name"
          rules={{ validate: (v) => providerNameError(v) ?? true }}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs">Name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={`${descriptor.type}-prod`}
                  maxLength={PROVIDER_NAME_MAX_LENGTH}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Use lowercase letters, digits and hyphens, at most {PROVIDER_NAME_MAX_LENGTH}{" "}
                characters. The name must be unique for this workspace. Agent slots use it to
                reference this provider.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        )}

        <IrsaAwareCredentialFields
          descriptor={descriptor}
          control={form.control}
          secretFieldPlaceholder={secretFieldPlaceholder}
        />
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// Step 2, second part: model, context window and save
// ---------------------------------------------------------------------------

function ModelPickerAndSave({
  descriptor,
  pickedModel,
  setPickedModel,
  setAsDefault,
  setSetAsDefault,
  capabilities,
  setCapabilities,
  embeddingModel,
  setEmbeddingModel,
  contextWindow,
  setContextWindow,
  onSave,
  isSavePending,
  blockedReason,
}: {
  descriptor: SupportedProviderDescriptor;
  pickedModel: string;
  setPickedModel: (m: string) => void;
  setAsDefault: boolean;
  setSetAsDefault: (b: boolean) => void;
  capabilities: ProviderCapability[];
  setCapabilities: (c: ProviderCapability[]) => void;
  embeddingModel: string;
  setEmbeddingModel: (m: string) => void;
  /** The stated context window of the chat model. A chat model needs it. */
  contextWindow: string;
  setContextWindow: (w: string) => void;
  onSave: () => void;
  isSavePending: boolean;
  /** Extra reason that the form is not ready, for example an invalid name. */
  blockedReason?: string | null;
}) {
  const servesChat = capabilities.includes("chat");
  const servesEmbedding = capabilities.includes("embedding");
  // Embedding-only providers (voyage/openai-compatible/tei) have only
  // embedding_models; the capability checkbox for chat is hidden entirely.
  const selectableCaps = selectableCapabilitiesForType(descriptor.type);
  const isEmbeddingOnly = isEmbeddingOnlyProviderType(descriptor.type);

  function toggleCapability(cap: ProviderCapability, on: boolean) {
    const next = on
      ? Array.from(new Set([...capabilities, cap]))
      : capabilities.filter((c) => c !== cap);
    // Re-order per the canonical PROVIDER_CAPABILITIES order for stable output.
    setCapabilities(PROVIDER_CAPABILITIES.filter((c) => next.includes(c)));
  }

  // The Save button is disabled when nothing actionable is configured: chat
  // needs a chat model; embedding needs an embedding model. At least one
  // capability must be selected.
  const embeddingReady = !servesEmbedding || Boolean(embeddingModel.trim());

  // Embedding model list: from gibson#1072 SupportedProvider.embeddingModels
  // (field 7). For embedding-only providers this IS the complete catalog.
  // For dual-capability providers (openai, bedrock, cohere) it is pre-filtered
  // by the daemon. Empty when the provider has no static embedding catalog
  // and the operator must type a model name manually.
  const embeddingModels: FoundModel[] = React.useMemo(() => {
    return (descriptor.embeddingModels ?? []).map((m) => ({
      name: m.name,
      family: m.family ?? "",
      contextWindow: m.contextWindow ?? 0,
    }));
  }, [descriptor.embeddingModels]);

  // The provider is not saved yet, so no live model list exists. The person
  // types the chat model and states its context window. The daemon refuses a
  // chat model with no stated window (gibson#1394).
  const statedWindow = Number(contextWindow);
  const windowReady =
    Number.isInteger(statedWindow) && statedWindow >= 1 && statedWindow <= 10_000_000;
  const chatReady = !servesChat || (pickedModel.trim() !== "" && windowReady);
  const saveDisabled =
    isSavePending ||
    capabilities.length === 0 ||
    !chatReady ||
    !embeddingReady ||
    Boolean(blockedReason);

  // When the provider is embedding-only, default the embedding model picker
  // to the first entry in the catalog if none has been selected yet.
  React.useEffect(() => {
    if (!embeddingModel && embeddingModels.length > 0 && servesEmbedding) {
      setEmbeddingModel(embeddingModels[0].name);
    }
  }, [embeddingModels, embeddingModel, setEmbeddingModel, servesEmbedding]);

  return (
    <div className="space-y-4">
      {/* Capabilities: which services this provider fulfills. Mirrors the
          proto Capability enum (chat / embedding); a provider may serve one or
          both (E11 BYO-embedder, gibson#810). Embedding-only types (voyage /
          openai-compatible / tei) show only the embedding checkbox. */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Capabilities</label>
        <p className="text-muted-foreground text-[11px]">
          {isEmbeddingOnly
            ? "This provider serves embeddings only."
            : "Choose which services this provider fulfills. Run e.g. one provider for chat and another for embeddings."}
        </p>
        <div className="flex flex-col gap-2 pt-0.5">
          {selectableCaps.map((cap) => (
            <label
              key={cap}
              className="flex items-center gap-2 text-xs"
              data-testid={`capability-${cap}`}
            >
              <Checkbox
                checked={capabilities.includes(cap)}
                onCheckedChange={(v) => toggleCapability(cap, v === true)}
                disabled={isEmbeddingOnly}
              />
              {capabilityLabel(cap)}
            </label>
          ))}
        </div>
        {capabilities.length === 0 && (
          <Alert>
            <AlertCircle className="size-4" />
            <AlertDescription className="text-xs">
              Select at least one capability.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {servesChat && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="chat-model" className="text-xs font-medium">
              Default chat model
            </label>
            <Input
              id="chat-model"
              value={pickedModel}
              onChange={(e) => setPickedModel(e.target.value)}
              placeholder="model-name"
              className="font-mono text-xs"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-muted-foreground text-[11px]">
              Type the model name. The test after the save lists the models that the provider
              offers.
            </p>
          </div>
          <div className="space-y-1">
            <label htmlFor="context-window" className="text-xs font-medium">
              Context window (tokens)
            </label>
            <Input
              id="context-window"
              type="number"
              min={1}
              max={10000000}
              step={1}
              inputMode="numeric"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="200000"
              className="font-mono text-xs"
              required
            />
            <p className="text-muted-foreground text-[11px]">
              The largest number of tokens that the chat model reads in one request. Find it in
              the documentation of the provider. Agents that need a minimum window use this value.
              Required for a chat model.
            </p>
          </div>
        </div>
      )}

      {servesEmbedding && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium">Default embedding model</label>
          <p className="text-muted-foreground text-[11px]">
            Used for vector recall, GraphRAG, belief-RAG and finding
            classification, independent of the chat model.
          </p>
          {embeddingModels.length > 0 ? (
            <Select
              value={embeddingModel}
              onValueChange={setEmbeddingModel}
            >
              <SelectTrigger className="w-full text-xs" data-testid="embedding-model-select">
                <SelectValue placeholder="Select embedding model" />
              </SelectTrigger>
              <SelectContent>
                {embeddingModels.map((m) => (
                  <SelectItem
                    key={m.name}
                    value={m.name}
                    className="font-mono text-xs"
                  >
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {/* Manual input: shown always so the operator can type a model name
              when the daemon's static catalog is empty (e.g. a custom TEI
              instance). Hidden visually but still present in the DOM for a11y. */}
          <Input
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
            placeholder="text-embedding-3-small"
            className="font-mono text-xs"
            data-testid="embedding-model-input"
          />
        </div>
      )}

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
        disabled={saveDisabled}
        className="text-xs"
      >
        {isSavePending && <Loader2 className="size-3 animate-spin" />}
        Save provider
      </Button>
      {blockedReason ? (
        <p className="text-muted-foreground text-[11px]" data-testid="save-blocked">
          {blockedReason}
        </p>
      ) : null}
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
  preselectDefault = false,
}: ProviderWizardProps) {
  // The wizard offers only the types that the model gateway routes.
  const offered = React.useMemo(
    () => supported.filter((d) => isOfferedProviderType(d.type)),
    [supported],
  );
  const [selectedType, setSelectedType] = React.useState<string>(
    isOfferedProviderType(initialType) ? initialType : "",
  );
  const [formValues, setFormValues] = React.useState<CredentialFormValues>({
    name: initialType,
    credentials: {},
  });
  const [pickedModel, setPickedModel] = React.useState<string>("");
  const [setAsDefault, setSetAsDefault] = React.useState<boolean>(preselectDefault);
  // The name of the provider after a successful save. It starts step 3.
  const [savedName, setSavedName] = React.useState<string | null>(null);
  // E11 BYO-embedder (gibson#810): a provider declares which services it
  // fulfills (chat and/or embedding) plus an independent default embedding
  // model. Default to chat-only — the legacy behavior — unless the
  // initialType is embedding-only (openai-compatible, gibson#1072).
  const [capabilities, setCapabilities] = React.useState<ProviderCapability[]>(
    () => defaultCapabilitiesForType(initialType),
  );
  const [embeddingModel, setEmbeddingModel] = React.useState<string>("");
  const [contextWindow, setContextWindow] = React.useState<string>("");

  const createMutation = useCreateProvider();
  const descriptor = offered.find((d) => d.type === selectedType);

  // step: 1 = pick type, 2 = credentials, model and save, 3 = test the saved provider.
  const step: 1 | 2 | 3 = savedName !== null ? 3 : !selectedType ? 1 : 2;

  function reset() {
    setSelectedType("");
    setFormValues({ name: "", credentials: {} });
    setPickedModel("");
    setSetAsDefault(false);
    setCapabilities(["chat"]);
    setEmbeddingModel("");
    setContextWindow("");
    setSavedName(null);
  }

  function pickType(type: string) {
    setSelectedType(type);
    setFormValues({ name: type, credentials: {} });
    setPickedModel("");
    setContextWindow("");
    // Embedding-only providers default to embedding capability only; others
    // default to chat.
    setCapabilities(defaultCapabilitiesForType(type));
    setEmbeddingModel("");
  }

  // Why the form cannot save yet, from the name and the required credentials.
  const blockedReason: string | null = React.useMemo(() => {
    if (!descriptor) return null;
    const nameProblem = providerNameError(formValues.name);
    if (nameProblem) return `Name: ${nameProblem}`;
    const missing = descriptor.credentials.find(
      (cf) => cf.required && !(formValues.credentials[cf.key] ?? "").trim(),
    );
    return missing ? `${missing.label} is required.` : null;
  }, [descriptor, formValues]);

  function save() {
    if (!descriptor) return;
    const servesEmbedding = capabilities.includes("embedding");
    const servesChat = capabilities.includes("chat");
    createMutation.mutate(
      {
        config: {
          type: descriptor.type,
          name: formValues.name,
          defaultModel: pickedModel,
          credentials: formValues.credentials,
          setAsDefault,
          capabilities,
          // Only send an embedding model when the provider serves embeddings;
          // otherwise leave it empty (provider is chat-only).
          defaultEmbeddingModel: servesEmbedding ? embeddingModel : "",
          // A chat model needs its stated window. The daemon reads no live list
          // at save time (gibson#1394).
          ...(servesChat ? { defaultModelContextWindow: Number(contextWindow) } : {}),
        },
      },
      {
        onSuccess: () => {
          toast.success(`${descriptor.displayName} saved`);
          setSavedName(formValues.name);
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
        <StepDot active={step >= 2} done={step > 2} label="Connect and save" />
        <StepConnector />
        <StepDot active={step >= 3} done={false} label="Test" />
      </div>

      <Separator />

      {step === 1 && <ProviderTypePicker supported={offered} onPick={pickType} />}

      {step === 2 && descriptor && (
        <div className="space-y-4">
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
          <CredentialsForm
            descriptor={descriptor}
            formValues={formValues}
            setFormValues={setFormValues}
          />
          <ModelPickerAndSave
            descriptor={descriptor}
            pickedModel={pickedModel}
            setPickedModel={setPickedModel}
            setAsDefault={setAsDefault}
            setSetAsDefault={setSetAsDefault}
            capabilities={capabilities}
            setCapabilities={setCapabilities}
            embeddingModel={embeddingModel}
            setEmbeddingModel={setEmbeddingModel}
            contextWindow={contextWindow}
            setContextWindow={setContextWindow}
            onSave={save}
            isSavePending={createMutation.isPending}
            blockedReason={blockedReason}
          />
        </div>
      )}

      {step === 3 && savedName !== null && (
        <ProviderTestPanel
          name={savedName}
          renderEdit={
            descriptor
              ? (ctl) => (
                  <EditCredentialsDialog
                    descriptor={descriptor}
                    providerName={savedName}
                    displayName={descriptor.displayName}
                    open={ctl.open}
                    onOpenChange={ctl.onOpenChange}
                    onSaved={ctl.onSaved}
                  />
                )
              : undefined
          }
          onDone={() => {
            reset();
            onComplete?.();
          }}
          onRemoved={() => {
            reset();
            onComplete?.();
          }}
        />
      )}

      {onCancel && step !== 3 && (
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
