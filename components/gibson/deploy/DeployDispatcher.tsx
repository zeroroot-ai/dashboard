'use client';

/**
 * DeployDispatcher — per-type dispatcher for the deploy wizard.
 *
 * Replaces the orphan DeployWizard.tsx (which showed generic helm /
 * docker / manual instructions referencing a non-existent component
 * chart and a hardcoded localhost:30002 URL).
 *
 * Branches:
 *   kind=plugin            → renders PluginRegisterWizard unchanged
 *   kind=agent | tool      → 4-step flow:
 *                              1. Type & name
 *                              2. Permissions
 *                              3. Credential panel (one-time)
 *                              4. Wait for connection
 *
 * Spec: component-bootstrap-e2e Requirements 1, 2, 5, 13.
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import {
  BotIcon,
  WrenchIcon,
  Plug2Icon,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

import { PluginRegisterWizard } from '@/src/components/plugin-register/wizard';
import {
  CredentialPanel,
  type Credentials,
} from '@/components/gibson/shared/CredentialPanel';
import {
  CatalogPicker,
  type GrantSelection as CatalogGrantSelection,
} from '@/components/gibson/permissions/CatalogPicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ComponentType = 'agent' | 'tool' | 'plugin';

interface GrantSelection {
  componentRef: string;
  relation: 'can_read' | 'can_configure' | 'can_execute' | 'can_invoke';
}

const TOTAL_STEPS = 4;
const POLL_TIMEOUT_MS = 300_000;

const COMPONENT_DEFS: Array<{
  type: ComponentType;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    type: 'agent',
    label: 'Agent',
    description: 'LLM-driven autonomous executor with tool access and memory.',
    icon: <BotIcon className="size-6 text-highlight" aria-hidden="true" />,
  },
  {
    type: 'tool',
    label: 'Tool',
    description: 'Stateless proto-based worker that consumes jobs from Redis queues.',
    icon: <WrenchIcon className="size-6 text-highlight" aria-hidden="true" />,
  },
  {
    type: 'plugin',
    label: 'Plugin',
    description: 'Stateful service integration with Initialize/Shutdown lifecycle.',
    icon: <Plug2Icon className="size-6 text-highlight" aria-hidden="true" />,
  },
];

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

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
        className="h-1 bg-muted [&>div]:bg-highlight [&>div]:shadow-[0_0_6px_rgba(34,197,94,0.6)]"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Select Type + Name
// ---------------------------------------------------------------------------

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
      <div>
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Select component type
        </h2>
        <p className="text-sm text-muted-foreground">
          Plugins are registered through their manifest; agents and tools are
          provisioned with OAuth2 credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {COMPONENT_DEFS.map(({ type, label, description, icon }) => {
          const isSelected = componentType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onTypeChange(type)}
              className={[
                'flex flex-col gap-3 rounded-lg p-4 text-left transition-all duration-150',
                'border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isSelected
                  ? 'ring-2 ring-highlight border-highlight/40 bg-highlight/10/20'
                  : 'border-highlight/20 hover:border-highlight/30 hover:bg-highlight/10/10',
              ].join(' ')}
              aria-pressed={isSelected}
            >
              <div className="flex items-center gap-2">
                {icon}
                {isSelected && (
                  <CheckCircle2 className="ml-auto size-4 text-highlight" aria-hidden="true" />
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

      <div className="space-y-1.5">
        <label
          htmlFor="component-name"
          className="text-xs font-medium font-mono uppercase tracking-wider text-muted-foreground"
        >
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
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed} className="gap-2">
          Next <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Permissions (minimal, advanced surface)
// ---------------------------------------------------------------------------

function PermissionsStep({
  componentType,
  grants,
  acknowledgedMinimal,
  onGrantsChange,
  onAcknowledgedChange,
  onBack,
  onNext,
}: {
  componentType: 'agent' | 'tool';
  grants: GrantSelection[];
  acknowledgedMinimal: boolean;
  onGrantsChange: (g: GrantSelection[]) => void;
  onAcknowledgedChange: (v: boolean) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refInput, setRefInput] = useState('');
  const [relInput, setRelInput] = useState<GrantSelection['relation']>('can_read');

  const canProceed = grants.length > 0 || acknowledgedMinimal;

  function addAdvancedGrant() {
    const ref = refInput.trim();
    if (ref === '') return;
    if (grants.some((g) => g.componentRef === ref && g.relation === relInput)) return;
    onGrantsChange([...grants, { componentRef: ref, relation: relInput }]);
    setRefInput('');
  }

  // Live count for the default-deny preview footer.
  const counts = grants.reduce(
    (acc, g) => {
      if (g.relation === 'can_read') acc.read += 1;
      else if (g.relation === 'can_configure') acc.configure += 1;
      else if (g.relation === 'can_execute') acc.execute += 1;
      else if (g.relation === 'can_invoke') acc.invoke += 1;
      return acc;
    },
    { read: 0, configure: 0, execute: 0, invoke: 0 },
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Permissions
        </h2>
        <p className="text-sm text-muted-foreground">
          Grant this {componentType} per-action access to components and
          (for tools) plugin invocation. Without explicit grants the {componentType}
          will only inherit tenant-member access.
        </p>
      </div>

      <CatalogPicker
        kind={componentType}
        selected={grants as CatalogGrantSelection[]}
        onChange={(next) => onGrantsChange(next as GrantSelection[])}
      />

      {/* Default-deny preview footer */}
      <Alert>
        <AlertTitle>This {componentType} will be able to:</AlertTitle>
        <AlertDescription className="text-xs">
          read {counts.read} component{counts.read === 1 ? '' : 's'},{' '}
          configure {counts.configure} component{counts.configure === 1 ? '' : 's'},{' '}
          execute {counts.execute} component{counts.execute === 1 ? '' : 's'}
          {componentType === 'tool' && (
            <>
              , and invoke {counts.invoke} plugin{counts.invoke === 1 ? '' : 's'}
            </>
          )}
          {grants.length === 0 && ' — i.e. only tenant-member inherited access'}.
        </AlertDescription>
      </Alert>

      {/* Show advanced — free-form (object_ref, relation) input for ops debugging */}
      <details className="text-xs">
        <summary
          className="cursor-pointer text-muted-foreground hover:text-foreground"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          Show technical detail
        </summary>
        <div className="mt-3 space-y-3 rounded border border-highlight/20 p-3">
          <p className="text-muted-foreground">
            Free-form grant entry. Use the catalog above unless you&apos;re
            adding a grant on an object the catalog doesn&apos;t list yet.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="grant-ref">
                Object (e.g. component:gitlab or plugin:gitlab)
              </label>
              <Input
                id="grant-ref"
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                className="font-mono w-72"
                placeholder="component:gitlab"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground" htmlFor="grant-rel">
                Relation
              </label>
              <select
                id="grant-rel"
                className="h-9 rounded-md border bg-background px-2 font-mono text-sm"
                value={relInput}
                onChange={(e) => setRelInput(e.target.value as GrantSelection['relation'])}
              >
                <option value="can_read">can_read</option>
                <option value="can_configure">can_configure</option>
                <option value="can_execute">can_execute</option>
                {componentType === 'tool' && <option value="can_invoke">can_invoke</option>}
              </select>
            </div>
            <Button type="button" onClick={addAdvancedGrant} disabled={refInput.trim() === ''}>
              Add
            </Button>
          </div>
        </div>
      </details>

      {grants.length === 0 && (
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={acknowledgedMinimal}
            onCheckedChange={(v) => onAcknowledgedChange(!!v)}
          />
          <span>
            I want minimal access. This {componentType} will only inherit
            tenant-member grants.
          </span>
        </label>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed} className="gap-2">
          Next <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Submit + Credential Panel
// ---------------------------------------------------------------------------

interface ApiError {
  error: { code: string; message: string };
}

function CredentialStep({
  componentName,
  componentType,
  grants,
  onAcknowledged,
  onBack,
}: {
  componentName: string;
  componentType: 'agent' | 'tool';
  grants: GrantSelection[];
  onAcknowledged: (creds: Credentials) => void;
  onBack: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: componentName,
          kind: componentType,
          componentGrants: grants,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiError | null;
        setError(body?.error?.message ?? `Request failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as Credentials;
      setCreds(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error');
    } finally {
      setSubmitting(false);
    }
  }

  if (creds) {
    return (
      <CredentialPanel
        credentials={creds}
        title={`${componentType[0].toUpperCase() + componentType.slice(1)} credentials`}
        onAcknowledge={() => onAcknowledged(creds)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Register {componentType}
        </h2>
        <p className="text-sm text-muted-foreground">
          The daemon will provision an OAuth2 service account and apply the
          permissions you set in the previous step. The client_secret is shown
          exactly once.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Registration failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button onClick={submit} disabled={submitting} className="gap-2">
          {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
          {submitting ? 'Registering…' : 'Register'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4: Wait for connection
// ---------------------------------------------------------------------------

function WaitForConnectionStep({
  componentType,
  componentName,
  onBack,
}: {
  componentType: 'agent' | 'tool' | 'plugin';
  componentName: string;
  onBack: () => void;
}) {
  const [pollStartTime, setPollStartTime] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  const [connected, setConnected] = useState(false);

  const segment =
    componentType === 'agent' ? 'agents' : componentType === 'tool' ? 'tools' : 'plugins';
  const arrayKey = segment;

  const { data } = useQuery({
    queryKey: ['deploy-poll', componentType, componentName, pollStartTime],
    queryFn: async () => {
      const res = await fetch(`/api/components/${segment}`);
      if (!res.ok) throw new Error(`Failed to fetch ${segment}`);
      return res.json();
    },
    refetchInterval: connected ? false : 3000,
    enabled: !connected,
  });

  useEffect(() => {
    if (!data || connected) return;
    const items: Array<{ name: string }> = data[arrayKey] ?? [];
    if (items.some((it) => it.name?.toLowerCase() === componentName.toLowerCase())) {
      setConnected(true);
    }
  }, [data, arrayKey, componentName, connected]);

  useEffect(() => {
    if (connected || timedOut) return;
    const t = setInterval(() => {
      if (Date.now() - pollStartTime >= POLL_TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(t);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [pollStartTime, connected, timedOut]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Waiting for connection
        </h2>
        <p className="text-sm text-muted-foreground">
          Run the enroll command on the {componentType}&apos;s host. The dashboard
          will detect it once it heartbeats.
        </p>
      </div>

      {connected ? (
        <div className="flex flex-col items-center gap-4 py-4">
          <CheckCircle2
            className="size-10 text-highlight"
            style={{ filter: 'drop-shadow(0 0 10px rgba(34,197,94,0.8))' }}
          />
          <p className="text-sm">
            <span className="data-value">{componentName}</span> is connected.
          </p>
          <Button asChild>
            <Link href={`/dashboard/${segment}`}>View {segment}</Link>
          </Button>
        </div>
      ) : timedOut ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Connection timeout</AlertTitle>
          <AlertDescription className="text-xs">
            The {componentType} hasn&apos;t connected in 5 minutes. Verify the
            credentials file path and the daemon URL on the host.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="size-8 animate-spin text-highlight" />
          <p className="text-xs text-muted-foreground">Polling every 3 seconds…</p>
        </div>
      )}

      {!connected && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
            <ArrowLeft className="size-4" />
            Back
          </Button>
          {timedOut && (
            <Button
              variant="outline"
              onClick={() => {
                setTimedOut(false);
                setPollStartTime(Date.now());
              }}
            >
              Retry
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface DeployDispatcherProps {
  initialType?: ComponentType;
}

export function DeployDispatcher({ initialType }: DeployDispatcherProps = {}) {
  const params = useSearchParams();
  const queryParam = params.get('type');
  const inferredInitial: ComponentType =
    initialType ??
    (queryParam === 'agent' || queryParam === 'tool' || queryParam === 'plugin'
      ? queryParam
      : 'agent');

  const [step, setStep] = useState(1);
  const [componentType, setComponentType] = useState<ComponentType>(inferredInitial);
  const [componentName, setComponentName] = useState('');
  const [grants, setGrants] = useState<GrantSelection[]>([]);
  const [acknowledgedMinimal, setAcknowledgedMinimal] = useState(false);

  // Plugin path: delegate entirely to PluginRegisterWizard. We render
  // the type-selection step first so the operator can switch back to
  // agent/tool, then hand off.
  if (componentType === 'plugin' && step >= 2) {
    return (
      <div className="max-w-2xl mx-auto py-8 px-4">
        <PluginRegisterWizard onClose={() => setStep(1)} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      <div className="mb-6 space-y-0.5">
        <h1 className="text-2xl font-bold tracking-tight font-mono text-glow-green">
          Deploy Component
        </h1>
        <p className="text-sm text-muted-foreground">
          Register a new agent, tool, or plugin with the Zero Root AI platform.
        </p>
      </div>

      <Card className="border-0 shadow-xl">
        <CardHeader className="pb-4">
          <StepIndicator
            step={step}
            total={componentType === 'plugin' ? 1 : TOTAL_STEPS}
          />
        </CardHeader>
        <Separator className="bg-highlight/20" />
        <CardContent className="pt-6 pb-8 px-6">
          {step === 1 && (
            <SelectTypeStep
              componentType={componentType}
              componentName={componentName}
              onTypeChange={setComponentType}
              onNameChange={setComponentName}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && componentType !== 'plugin' && (
            <PermissionsStep
              componentType={componentType}
              grants={grants}
              acknowledgedMinimal={acknowledgedMinimal}
              onGrantsChange={setGrants}
              onAcknowledgedChange={setAcknowledgedMinimal}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && componentType !== 'plugin' && (
            <CredentialStep
              componentName={componentName}
              componentType={componentType}
              grants={grants}
              onBack={() => setStep(2)}
              onAcknowledged={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <WaitForConnectionStep
              componentType={componentType}
              componentName={componentName}
              onBack={() => setStep(3)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
