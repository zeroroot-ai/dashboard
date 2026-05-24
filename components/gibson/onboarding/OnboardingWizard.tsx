"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, ChevronRight, Loader2, Shield, SkipForward } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useOnboardingStatus } from "@/src/hooks/useOnboardingStatus";
import { useOnboardingStore } from "@/src/stores/onboarding-store";
import { useCreateProvider } from "@/src/hooks/useProviderMutations";

// ── Constants ──────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

const LLM_PROVIDERS = [
  { value: "anthropic", label: "Anthropic (Claude)" },
  { value: "openai", label: "OpenAI (GPT)" },
  { value: "google", label: "Google Gemini" },
  { value: "ollama", label: "Ollama (Local)" },
] as const;

type LLMProviderValue = (typeof LLM_PROVIDERS)[number]["value"];

const MISSION_TEMPLATES = [
  { value: "external-recon", label: "External Reconnaissance" },
  { value: "subdomain-enum", label: "Subdomain Enumeration" },
  { value: "api-surface-scan", label: "API Surface Scan" },
  { value: "vuln-assessment", label: "Vulnerability Assessment" },
  { value: "blank", label: "Blank — No Template" },
] as const;

// ── Schemas ────────────────────────────────────────────────────────────────────

const llmProviderSchema = z.object({
  provider: z.string().min(1, "Please select a provider"),
  apiKey: z.string().optional(),
});

const firstMissionSchema = z.object({
  targetDomain: z
    .string()
    .min(2, "Target domain is required")
    .max(253, "Domain is too long")
    .trim(),
  template: z.string().min(1, "Please select a template"),
});

type LLMProviderFormValues = z.infer<typeof llmProviderSchema>;
type FirstMissionFormValues = z.infer<typeof firstMissionSchema>;

// ── Shared wizard state ────────────────────────────────────────────────────────

interface WizardState {
  llmProvider?: string;
  targetDomain?: string;
  missionTemplate?: string;
  missionId?: string;
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  const percent = Math.round(((step - 1) / (total - 1)) * 100);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
        <span>Step {step} of {total}</span>
        <span>{percent}%</span>
      </div>
      <Progress
        value={percent}
        className="h-1 bg-muted [&>div]:bg-highlight [&>div]:shadow-[0_0_6px_rgba(34,197,94,0.6)]"
      />
    </div>
  );
}

// ── Step 1: Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center space-y-8 py-4">
      <div className="relative flex flex-col items-center gap-3">
        <div
          className="flex size-20 items-center justify-center rounded-2xl glass-hack"
          aria-hidden="true"
        >
          <Shield
            className="size-10 text-highlight"
            style={{ filter: "drop-shadow(0 0 8px rgba(34,197,94,0.7))" }}
          />
        </div>
        <p className="data-value text-xs tracking-[0.3em] uppercase">Zero Day AI</p>
      </div>

      <div className="space-y-3 max-w-sm">
        <h2 className="text-2xl font-bold tracking-tight text-glow-green font-mono lg:text-3xl">
          Welcome to Zero Day AI<br />Mission Control
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Kubernetes-native AI agent orchestration for autonomous security operations. Configure
          your environment in a few steps and launch your first mission.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-2 text-left w-full max-w-xs" role="list">
        {[
          "LLM-driven autonomous agents",
          "GraphRAG-powered knowledge graph",
          "Real-time mission DAG orchestration",
          "Security tool integration (nmap, nuclei, httpx)",
        ].map((feature) => (
          <li key={feature} className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-3.5 shrink-0 text-highlight" aria-hidden="true" />
            {feature}
          </li>
        ))}
      </ul>

      <Button size="lg" onClick={onNext} className="gap-2 min-w-40">
        Get Started
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

// ── Step 2: LLM Provider ───────────────────────────────────────────────────────

function LLMProviderStep({
  onNext,
  onSkip,
  onStateChange,
}: {
  onNext: () => void;
  onSkip: () => void;
  onStateChange: (values: Partial<WizardState>) => void;
}) {
  const createProvider = useCreateProvider();
  const store = useOnboardingStore();

  const form = useForm<LLMProviderFormValues>({
    resolver: zodResolver(llmProviderSchema),
    defaultValues: {
      provider: store.llmConfig?.provider ?? "",
      apiKey: "",
    },
  });

  const selectedProvider = form.watch("provider") as LLMProviderValue | "";
  const requiresApiKey = selectedProvider && selectedProvider !== "ollama";

  async function onSubmit(values: LLMProviderFormValues) {
    try {
      await createProvider.mutateAsync({
        config: {
          type: values.provider,
          name: values.provider,
          defaultModel: '',
          credentials: values.apiKey ? { api_key: values.apiKey } : {},
        },
        testConnection: false,
      });

      store.setLLMProvider(values.provider as LLMProviderValue);
      if (values.apiKey) store.setLLMApiKey(values.apiKey);
      store.setLLMValidated(true);

      onStateChange({ llmProvider: values.provider });
      onNext();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save provider."
      );
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Configure your AI provider
        </h2>
        <p className="text-sm text-muted-foreground">
          Zero Day AI uses LLM slots to abstract provider selection. Agents declare requirements —
          never a specific model.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="provider"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono">Provider</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full font-mono">
                      <SelectValue placeholder="Select an AI provider" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LLM_PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="font-mono">
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>The LLM provider used to power your agents.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {requiresApiKey && (
            <FormField
              control={form.control}
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono">API Key</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="sk-..."
                      className="font-mono"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Your API key is stored as a Kubernetes secret and never logged.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={createProvider.isPending} className="gap-2">
              {createProvider.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="size-4" />
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSkip}
              disabled={createProvider.isPending}
              className="gap-1.5 text-muted-foreground"
            >
              <SkipForward className="size-3.5" />
              Skip
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ── Step 3: First Mission ──────────────────────────────────────────────────────

function FirstMissionStep({
  onNext,
  onSkip,
  onStateChange,
}: {
  onNext: () => void;
  onSkip: () => void;
  onStateChange: (values: Partial<WizardState>) => void;
}) {
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const store = useOnboardingStore();

  const form = useForm<FirstMissionFormValues>({
    resolver: zodResolver(firstMissionSchema),
    defaultValues: {
      targetDomain: store.missionTarget ?? "",
      template: store.usedTemplateId ?? "",
    },
  });

  async function onSubmit(values: FirstMissionFormValues) {
    setIsSubmitting(true);
    try {
      // Load template CUE source (lands in dashboard#293; no-ops gracefully
      // until template .cue files are vendored).
      const { getTemplateCUESourceAction, createMissionFromCUEAction } =
        await import("@/app/actions/missions/create-mission");
      const templateCUE = await getTemplateCUESourceAction(values.template);
      const cueSource = templateCUE ?? [
        "package mission",
        `name: "${values.template} — ${values.targetDomain}"`,
        `description: "Onboarding mission seeded from template ${values.template}"`,
      ].join("\n");

      const res = await createMissionFromCUEAction({
        cueSource,
        name: `${values.template} — ${values.targetDomain}`,
      });

      if (!res.ok) {
        throw new Error(res.error);
      }

      store.setMissionTarget(values.targetDomain);
      store.setUsedTemplateId(values.template);
      store.setCreatedMissionId(res.missionId);

      onStateChange({
        targetDomain: values.targetDomain,
        missionTemplate: values.template,
        missionId: res.missionId,
      });
      onNext();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create mission."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Launch your first mission
        </h2>
        <p className="text-sm text-muted-foreground">
          Define a target and pick a template — Zero Day AI will wire up the agent DAG automatically.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="targetDomain"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono">Target Domain</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. acme.io"
                    className="font-mono"
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  The primary domain or IP to target. You can add more scope in the mission editor.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="template"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono">Mission Template</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full font-mono">
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MISSION_TEMPLATES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="font-mono">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Choose a pre-built template or start from scratch.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={isSubmitting} className="gap-2">
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Next
                  <ChevronRight className="size-4" />
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSkip}
              disabled={isSubmitting}
              className="gap-1.5 text-muted-foreground"
            >
              <SkipForward className="size-3.5" />
              Skip
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}

// ── Step 4: Complete ───────────────────────────────────────────────────────────

function CompleteStep({
  state,
  onFinish,
}: {
  state: WizardState;
  onFinish: () => void;
}) {
  const configured = [
    state.llmProvider && {
      label: "AI Provider",
      value:
        LLM_PROVIDERS.find((p) => p.value === state.llmProvider)?.label ??
        state.llmProvider,
    },
    state.targetDomain && { label: "Target Domain", value: state.targetDomain },
    state.missionTemplate && {
      label: "Mission Template",
      value:
        MISSION_TEMPLATES.find((t) => t.value === state.missionTemplate)?.label ??
        state.missionTemplate,
    },
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div className="flex flex-col items-center text-center space-y-8 py-4">
      <div
        className="flex size-20 items-center justify-center rounded-full glass-hack"
        aria-hidden="true"
      >
        <CheckCircle2
          className="size-12 text-highlight"
          style={{ filter: "drop-shadow(0 0 10px rgba(34,197,94,0.8))" }}
        />
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-2xl font-bold tracking-tight font-mono text-glow-green">
          You&apos;re all set!
        </h2>
        <p className="text-sm text-muted-foreground">
          Zero Day AI Mission Control is ready. Here&apos;s a summary of what was configured.
        </p>
      </div>

      {configured.length > 0 ? (
        <div className="w-full max-w-xs rounded-lg border border-highlight/30 bg-highlight/10/10 p-4 text-left space-y-3">
          {configured.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider shrink-0">
                {label}
              </span>
              <span className="data-value text-xs text-right break-all">{value}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No configuration saved — you can set things up in Settings.
        </p>
      )}

      <Button size="lg" onClick={onFinish} className="min-w-48">
        Go to Dashboard
      </Button>
    </div>
  );
}

// ── Main wizard ────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const router = useRouter();
  const store = useOnboardingStore();
  const { shouldShowOnboarding, updateState } = useOnboardingStatus();

  const [step, setStep] = React.useState(1);
  const [wizardState, setWizardState] = React.useState<WizardState>({});

  // If onboarding is already done, redirect immediately
  React.useEffect(() => {
    if (!shouldShowOnboarding) {
      router.replace("/dashboard");
    }
  }, [shouldShowOnboarding, router]);

  function updateWizardState(values: Partial<WizardState>) {
    setWizardState((prev) => ({ ...prev, ...values }));
  }

  function goNext() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goSkip() {
    goNext();
  }

  async function handleFinish() {
    // Mark wizard complete in the Zustand store (persisted)
    store.completeWizard();

    // Sync to server
    try {
      await updateState({
        wizardCompleted: true,
        completedSteps: store.completedSteps,
        llmConfig: store.llmConfig ?? undefined,
        createdMissionId: store.createdMissionId ?? undefined,
      });
    } catch {
      // Non-fatal — local store is already updated
    }

    router.push("/dashboard");
  }

  return (
    <div className="flex min-h-[calc(100vh-var(--header-height)-var(--content-padding)*2)] items-start justify-center py-8 px-4">
      <div className="w-full max-w-lg">
        <Card className="glass-hack border-0 shadow-xl">
          <CardHeader className="pb-4">
            <StepIndicator step={step} total={TOTAL_STEPS} />
          </CardHeader>

          <Separator className="bg-highlight/20" />

          <CardContent className="pt-6 pb-8 px-6">
            {step === 1 && <WelcomeStep onNext={goNext} />}
            {step === 2 && (
              <LLMProviderStep
                onNext={goNext}
                onSkip={goSkip}
                onStateChange={updateWizardState}
              />
            )}
            {step === 3 && (
              <FirstMissionStep
                onNext={goNext}
                onSkip={goSkip}
                onStateChange={updateWizardState}
              />
            )}
            {step === 4 && (
              <CompleteStep state={wizardState} onFinish={handleFinish} />
            )}
          </CardContent>
        </Card>

        {/* Skip onboarding entirely */}
        {step < 4 && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Already configured?{" "}
            <Link
              href="/dashboard"
              className="text-highlight hover:text-highlight transition-colors underline underline-offset-2"
              onClick={() => {
                store.skipWizard();
                updateState({ wizardSkipped: true }).catch(() => {});
              }}
            >
              Skip onboarding
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
