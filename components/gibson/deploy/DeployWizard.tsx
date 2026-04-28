"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  BotIcon,
  WrenchIcon,
  Plug2Icon,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Copy,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ComponentType = "agent" | "tool" | "plugin";

// ── Constants ─────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 3;
const DEFAULT_PLATFORM_URL = "http://localhost:30002";
const POLL_TIMEOUT_MS = 300_000; // 5 minutes

const COMPONENT_DEFS: Array<{
  type: ComponentType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    type: "agent",
    label: "Agent",
    description: "LLM-driven autonomous executor with tool access and memory.",
    icon: <BotIcon className="size-6 text-green-400" aria-hidden="true" />,
  },
  {
    type: "tool",
    label: "Tool",
    description: "Stateless proto-based worker that consumes jobs from Redis queues.",
    icon: <WrenchIcon className="size-6 text-green-400" aria-hidden="true" />,
  },
  {
    type: "plugin",
    label: "Plugin",
    description: "Stateful service integration with Initialize/Shutdown lifecycle.",
    icon: <Plug2Icon className="size-6 text-green-400" aria-hidden="true" />,
  },
];

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ step, total }: { step: number; total: number }) {
  const percent = Math.round(((step - 1) / (total - 1)) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono">
        <span>Step {step} of {total}</span>
        <span>{percent}%</span>
      </div>
      <Progress
        value={percent}
        className="h-1 bg-muted [&>div]:bg-green-500 [&>div]:shadow-[0_0_6px_rgba(34,197,94,0.6)]"
      />
      <div className="flex gap-2 mt-1">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={[
              "flex-1 h-0.5 rounded-full transition-all duration-300",
              i < step ? "bg-green-500" : "bg-muted",
            ].join(" ")}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

// ── Step 1: Select Type + Name ────────────────────────────────────────────────

function SelectTypeStep({
  componentType,
  componentName,
  onTypeChange,
  onNameChange,
  onNext,
}: {
  componentType: ComponentType;
  componentName: string;
  onTypeChange: (t: ComponentType) => void;
  onNameChange: (n: string) => void;
  onNext: () => void;
}) {
  const canProceed = componentName.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Select component type
        </h2>
        <p className="text-sm text-muted-foreground">
          Choose what kind of component you want to deploy to the Zero Day AI platform.
        </p>
      </div>

      {/* Type selector cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COMPONENT_DEFS.map(({ type, label, description, icon }) => {
          const isSelected = componentType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onTypeChange(type)}
              className={[
                "flex flex-col gap-3 rounded-lg p-4 text-left transition-all duration-150",
                "glass-hack border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "ring-2 ring-green-500 border-green-500/40 bg-green-950/20"
                  : "border-green-900/20 hover:border-green-500/30 hover:bg-green-950/10",
              ].join(" ")}
              aria-pressed={isSelected}
            >
              <div className="flex items-center gap-2">
                {icon}
                {isSelected && (
                  <CheckCircle2
                    className="ml-auto size-4 text-green-500 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold font-mono text-foreground">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Component name */}
      <div className="space-y-1.5">
        <label htmlFor="component-name" className="text-xs font-medium font-mono uppercase tracking-wider text-muted-foreground">
          Component name
        </label>
        <Input
          id="component-name"
          value={componentName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g., my-custom-scanner"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Used to identify this component in the Zero Day AI registry.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex justify-end pt-1">
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="gap-2"
        >
          Next
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Code block with copy button ───────────────────────────────────────────────

function CodeBlock({ code, label }: { code: string; label: string }) {
  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => {
      toast.success(`${label} command copied`);
    }).catch(() => {
      toast.error("Failed to copy");
    });
  }

  return (
    <div className="relative">
      <pre className="font-mono bg-muted p-4 rounded-lg text-xs leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleCopy}
        className="absolute top-2 right-2 size-7 text-muted-foreground hover:text-foreground"
        aria-label={`Copy ${label} command`}
      >
        <Copy className="size-3.5" />
      </Button>
    </div>
  );
}

// ── Step 2: Deploy Instructions ───────────────────────────────────────────────

function DeployInstructionsStep({
  componentType,
  componentName,
  platformUrl,
  onBack,
  onNext,
}: {
  componentType: ComponentType;
  componentName: string;
  platformUrl: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const kubernetesCmd = [
    `helm install ${componentName} gibson/component \\`,
    `  --set type=${componentType} \\`,
    `  --set name=${componentName} \\`,
    `  --set platformUrl=${platformUrl}`,
  ].join("\n");

  const dockerCmd = [
    `docker run -d \\`,
    `  -e GIBSON_PLATFORM_URL=${platformUrl} \\`,
    `  -e TOOL_NAME=${componentName} \\`,
    `  your-image:latest`,
  ].join("\n");

  const manualEnv = [
    `GIBSON_PLATFORM_URL=${platformUrl}`,
  ].join("\n");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Deploy your component
        </h2>
        <p className="text-sm text-muted-foreground">
          Use one of the methods below to start your{" "}
          <span className="data-value">{componentName}</span> {componentType}.
        </p>
      </div>

      <Tabs defaultValue="kubernetes">
        <TabsList className="w-full">
          <TabsTrigger value="kubernetes" className="flex-1 font-mono text-xs">
            Kubernetes
          </TabsTrigger>
          <TabsTrigger value="docker" className="flex-1 font-mono text-xs">
            Docker
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex-1 font-mono text-xs">
            Manual
          </TabsTrigger>
        </TabsList>

        <TabsContent value="kubernetes" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Deploy using the official Zero Day AI Helm chart. Requires the{" "}
            <span className="font-mono">gibson/component</span> chart in your Helm repo.
          </p>
          <CodeBlock code={kubernetesCmd} label="Helm" />
        </TabsContent>

        <TabsContent value="docker" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Run your component as a Docker container. Replace{" "}
            <span className="font-mono">your-image:latest</span> with your image.
          </p>
          <CodeBlock code={dockerCmd} label="Docker" />
        </TabsContent>

        <TabsContent value="manual" className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Set these environment variables in your process or shell before starting the component.
          </p>
          <CodeBlock code={manualEnv} label="Env vars" />
        </TabsContent>
      </Tabs>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button onClick={onNext} className="gap-2">
          Next
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ── Step 4: Wait for Connection ───────────────────────────────────────────────

// Map component type → the API route segment and response array key.
const COMPONENT_POLL_CONFIG: Record<
  ComponentType,
  { segment: string; arrayKey: string }
> = {
  agent: { segment: "agents", arrayKey: "agents" },
  tool: { segment: "tools", arrayKey: "tools" },
  plugin: { segment: "plugins", arrayKey: "plugins" },
};

function WaitForConnectionStep({
  componentType,
  componentName,
  onBack,
}: {
  componentType: ComponentType;
  componentName: string;
  onBack: () => void;
}) {
  const [connected, setConnected] = useState(false);
  const [pollStartTime, setPollStartTime] = useState<number>(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);

  const { segment, arrayKey } = COMPONENT_POLL_CONFIG[componentType];

  const { data } = useQuery({
    queryKey: ["deploy-poll", componentType, componentName, pollStartTime],
    queryFn: async () => {
      const res = await fetch(`/api/components/${segment}`);
      if (!res.ok) throw new Error(`Failed to fetch ${segment}`);
      return res.json();
    },
    refetchInterval: connected ? false : 3000,
    enabled: !connected,
  });

  // Check if the component has appeared in the list
  useEffect(() => {
    if (!data || connected) return;
    const items: Array<{ name: string }> = data[arrayKey] ?? [];
    const found = items.some(
      (item) => item.name?.toLowerCase() === componentName.toLowerCase()
    );
    if (found) {
      setConnected(true);
    }
  }, [data, arrayKey, componentName, connected]);

  // Poll timeout check
  useEffect(() => {
    if (connected || timedOut) return;
    const interval = setInterval(() => {
      if (Date.now() - pollStartTime >= POLL_TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(interval);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [pollStartTime, connected, timedOut]);

  function handleRetry() {
    setTimedOut(false);
    setPollStartTime(Date.now());
  }

  const destinationHref = `/dashboard/${segment}`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Waiting for connection
        </h2>
        <p className="text-sm text-muted-foreground">
          Start your component with the credentials from the previous steps. Zero Day AI will detect it
          automatically once it connects.
        </p>
      </div>

      {/* Connected state */}
      {connected && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div
            className="flex size-16 items-center justify-center rounded-full glass-hack"
            aria-hidden="true"
          >
            <CheckCircle2
              className="size-10 text-green-400"
              style={{ filter: "drop-shadow(0 0 10px rgba(34,197,94,0.8))" }}
            />
          </div>
          <div className="text-center space-y-1">
            <p className="text-lg font-bold font-mono text-glow-green">Connected!</p>
            <p className="text-sm text-muted-foreground">
              <span className="data-value">{componentName}</span> is live on the Zero Day AI platform.
            </p>
          </div>
          <Button asChild className="gap-2 mt-2">
            <Link href={destinationHref}>
              View {componentType}s
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      )}

      {/* Timed out state */}
      {!connected && timedOut && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-950/10 p-4">
            <AlertTriangle className="size-4 shrink-0 text-amber-400 mt-0.5" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-medium text-amber-400">Connection timeout</p>
              <p className="text-xs text-muted-foreground">
                {componentName} hasn't appeared after 5 minutes. Check the following:
              </p>
            </div>
          </div>

          <ul className="space-y-2 text-sm text-muted-foreground list-none">
            {[
              "Check that GIBSON_PLATFORM_URL and agent credentials are set correctly",
              "Check that your component can reach the Zero Day AI endpoint",
              "Check component logs for authentication errors",
            ].map((tip) => (
              <li key={tip} className="flex items-start gap-2">
                <span className="mt-1 text-amber-500/60" aria-hidden="true">▸</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>

          <Button variant="outline" onClick={handleRetry} className="gap-2">
            <Loader2 className="size-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Polling state */}
      {!connected && !timedOut && (
        <div className="flex flex-col items-center gap-4 py-6">
          <Loader2
            className="size-10 animate-spin text-green-500"
            aria-label="Waiting for component connection"
          />
          <p className="text-sm text-muted-foreground text-center">
            Waiting for{" "}
            <span className="data-value">{componentName}</span> to connect...
          </p>
          <p className="text-xs text-muted-foreground/60">
            Polling every 3 seconds
          </p>
        </div>
      )}

      {/* Navigation */}
      {!connected && (
        <div className="flex items-center justify-between pt-1">
          <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
            <ArrowLeft className="size-4" />
            Back
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function DeployWizard() {
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [componentType, setComponentType] = useState<ComponentType>(
    () => {
      const param = searchParams.get("type");
      if (param === "agent" || param === "tool" || param === "plugin") return param;
      return "agent";
    }
  );
  const [componentName, setComponentName] = useState("");

  // Derive a stable platform URL (configurable later via /api/config).
  const platformUrl = DEFAULT_PLATFORM_URL;

  function handleNext() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function handleBack() {
    setStep((s) => Math.max(s - 1, 1));
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* Page title */}
      <div className="mb-6 space-y-0.5">
        <h1 className="text-2xl font-bold tracking-tight font-mono text-glow-green">
          Deploy Component
        </h1>
        <p className="text-sm text-muted-foreground">
          Register a new agent, tool, or plugin with the Zero Day AI platform.
        </p>
      </div>

      <Card className="glass-hack border-0 shadow-xl">
        <CardHeader className="pb-4">
          <StepIndicator step={step} total={TOTAL_STEPS} />
        </CardHeader>

        <Separator className="bg-green-900/20" />

        <CardContent className="pt-6 pb-8 px-6">
          {step === 1 && (
            <SelectTypeStep
              componentType={componentType}
              componentName={componentName}
              onTypeChange={setComponentType}
              onNameChange={setComponentName}
              onNext={handleNext}
            />
          )}

          {step === 2 && (
            <DeployInstructionsStep
              componentType={componentType}
              componentName={componentName}
              platformUrl={platformUrl}
              onBack={handleBack}
              onNext={handleNext}
            />
          )}

          {step === 3 && (
            <WaitForConnectionStep
              componentType={componentType}
              componentName={componentName}
              onBack={handleBack}
            />
          )}
        </CardContent>
      </Card>

    </div>
  );
}
