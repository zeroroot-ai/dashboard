'use client';

/**
 * PermissionsTab — agent / tool detail Permissions tab.
 *
 * Renders four sections from a WhoAmIResponse fetched server-side by
 * the page route: effective-access summary, direct grants (editable),
 * inherited grants (read-only with source links), and active capability
 * grants. The Add-grant modal hosts CatalogPicker filtered to exclude
 * grants the principal already has.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 4.
 */

import { useState, useTransition } from 'react';
import { Trash2, Plus, AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

import {
  CatalogPicker,
  type GrantSelection,
} from '@/components/gibson/permissions/CatalogPicker';
import {
  writeAgentGrantsAction,
  deleteAgentGrantsAction,
} from '@/app/actions/agent-permissions';

// ---------------------------------------------------------------------------
// Wire types — mirror WhoAmIResponse projection from the server
// ---------------------------------------------------------------------------

export type SourceKind =
  | 'KIND_DIRECT'
  | 'KIND_TENANT_MEMBER'
  | 'KIND_TEAM_MEMBER'
  | 'KIND_OWNER';

export interface SourceVM {
  kind: SourceKind;
  sourceObject: string;
}
export interface ComponentGrantVM {
  componentRef: string;
  canRead: boolean;
  canConfigure: boolean;
  canExecute: boolean;
  sources: SourceVM[];
}
export interface PluginGrantVM {
  pluginRef: string;
  sources: SourceVM[];
}
export interface ActiveGrantVM {
  jti: string;
  recipientName: string;
  expiresAtUnix: number;
  nearExpiry: boolean;
  allowedRpcs: string[];
}
export interface PermissionsTabProps {
  principalId: string;
  kind: 'agent' | 'tool';
  componentGrants: ComponentGrantVM[];
  pluginGrants: PluginGrantVM[];
  activeCapabilityGrants: ActiveGrantVM[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flatten(componentGrants: ComponentGrantVM[], pluginGrants: PluginGrantVM[]) {
  const direct: GrantSelection[] = [];
  const inherited: Array<{ grant: GrantSelection; sources: SourceVM[] }> = [];
  for (const c of componentGrants) {
    const groups = [
      { rel: 'can_read' as const, present: c.canRead },
      { rel: 'can_configure' as const, present: c.canConfigure },
      { rel: 'can_execute' as const, present: c.canExecute },
    ];
    for (const g of groups) {
      if (!g.present) continue;
      const inheritedSources = c.sources.filter((s) => s.kind !== 'KIND_DIRECT');
      const isDirect = c.sources.some((s) => s.kind === 'KIND_DIRECT');
      const grant: GrantSelection = { componentRef: c.componentRef, relation: g.rel };
      if (isDirect) direct.push(grant);
      if (inheritedSources.length > 0) inherited.push({ grant, sources: inheritedSources });
    }
  }
  for (const p of pluginGrants) {
    const inheritedSources = p.sources.filter((s) => s.kind !== 'KIND_DIRECT');
    const isDirect = p.sources.some((s) => s.kind === 'KIND_DIRECT');
    const grant: GrantSelection = { componentRef: p.pluginRef, relation: 'can_invoke' };
    if (isDirect) direct.push(grant);
    if (inheritedSources.length > 0) inherited.push({ grant, sources: inheritedSources });
  }
  return { direct, inherited };
}

function sourceLabel(s: SourceVM) {
  switch (s.kind) {
    case 'KIND_TENANT_MEMBER':
      return `via ${s.sourceObject || 'tenant'}#member`;
    case 'KIND_TEAM_MEMBER':
      return `via ${s.sourceObject || 'team'}#member`;
    case 'KIND_OWNER':
      return `via ${s.sourceObject || 'owner'}#owner`;
    case 'KIND_DIRECT':
      return 'direct';
    default:
      return 'unknown';
  }
}

function formatTime(unix: number) {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

// ---------------------------------------------------------------------------
// PermissionsTab
// ---------------------------------------------------------------------------

export function PermissionsTab(props: PermissionsTabProps) {
  const { principalId, kind, componentGrants, pluginGrants, activeCapabilityGrants } = props;
  const { direct, inherited } = flatten(componentGrants, pluginGrants);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const summary = {
    read: componentGrants.filter((c) => c.canRead).length,
    configure: componentGrants.filter((c) => c.canConfigure).length,
    execute: componentGrants.filter((c) => c.canExecute).length,
    invoke: pluginGrants.length,
  };

  function handleRemove(g: GrantSelection) {
    if (!confirm(`Remove grant "${g.componentRef}" / ${g.relation}?`)) return;
    startTransition(async () => {
      const res = await deleteAgentGrantsAction(principalId, [
        { object: g.componentRef, relation: g.relation },
      ]);
      if (!res.ok) {
        toast.error(`Failed to remove grant: ${res.error}`);
        return;
      }
      toast.success(
        res.data.deleted === 1
          ? 'Grant removed'
          : `Grant was already absent (no-op)`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <EffectiveSummary kind={kind} summary={summary} />

      <DirectGrantsSection
        direct={direct}
        inherited={inherited.map((i) => i.grant)}
        principalId={principalId}
        kind={kind}
        onRemove={handleRemove}
        isPending={isPending}
        onAdded={() => router.refresh()}
      />

      <InheritedGrantsSection inherited={inherited} />

      <ActiveCapabilityGrantsSection grants={activeCapabilityGrants} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Effective access summary
// ---------------------------------------------------------------------------

function EffectiveSummary({
  kind,
  summary,
}: {
  kind: 'agent' | 'tool';
  summary: { read: number; configure: number; execute: number; invoke: number };
}) {
  return (
    <Alert>
      <AlertTitle>Effective access</AlertTitle>
      <AlertDescription className="text-xs">
        This {kind} can read {summary.read} component
        {summary.read === 1 ? '' : 's'}, configure {summary.configure} component
        {summary.configure === 1 ? '' : 's'}, and execute {summary.execute} component
        {summary.execute === 1 ? '' : 's'}
        {kind === 'tool' && (
          <>
            {' '}
            — and invoke {summary.invoke} plugin{summary.invoke === 1 ? '' : 's'}
          </>
        )}
        .
      </AlertDescription>
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// Direct grants
// ---------------------------------------------------------------------------

function DirectGrantsSection({
  direct,
  inherited,
  principalId,
  kind,
  onRemove,
  isPending,
  onAdded,
}: {
  direct: GrantSelection[];
  inherited: GrantSelection[];
  principalId: string;
  kind: 'agent' | 'tool';
  onRemove: (g: GrantSelection) => void;
  isPending: boolean;
  onAdded: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 pt-3">
        <CardTitle className="text-sm">Direct grants ({direct.length})</CardTitle>
        <AddGrantDialog
          principalId={principalId}
          kind={kind}
          alreadyGranted={[...direct, ...inherited]}
          onAdded={onAdded}
        />
      </CardHeader>
      <CardContent>
        {direct.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No direct grants. This {kind} only has access through inherited
            relations (see below).
          </p>
        ) : (
          <ul className="space-y-1 text-xs font-mono">
            {direct.map((g, i) => (
              <li
                key={`${g.componentRef}|${g.relation}|${i}`}
                className="flex items-center justify-between rounded border border-highlight/20 px-3 py-1.5"
              >
                <span>
                  <span className="data-value">{g.componentRef}</span> — {g.relation}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => onRemove(g)}
                  aria-label={`Remove ${g.componentRef} ${g.relation}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Add-grant dialog (hosts CatalogPicker)
// ---------------------------------------------------------------------------

function AddGrantDialog({
  principalId,
  kind,
  alreadyGranted,
  onAdded,
}: {
  principalId: string;
  kind: 'agent' | 'tool';
  alreadyGranted: GrantSelection[];
  onAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<GrantSelection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (picked.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await writeAgentGrantsAction(
        principalId,
        picked.map((g) => ({ object: g.componentRef, relation: g.relation })),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(`${res.data.written} grant${res.data.written === 1 ? '' : 's'} added`);
      setPicked([]);
      setOpen(false);
      onAdded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="size-3.5" />
          Add grant
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add grants</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Could not add grants</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <CatalogPicker
            kind={kind}
            selected={picked}
            onChange={setPicked}
            excludeAlreadyGranted={alreadyGranted}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || picked.length === 0}>
            {submitting && <Loader2 className="size-3.5 animate-spin mr-2" />}
            Add {picked.length > 0 && `(${picked.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Inherited grants
// ---------------------------------------------------------------------------

function InheritedGrantsSection({
  inherited,
}: {
  inherited: Array<{ grant: GrantSelection; sources: SourceVM[] }>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm">
          Inherited grants ({inherited.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {inherited.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No inherited grants.
          </p>
        ) : (
          <ul className="space-y-1 text-xs">
            {inherited.map((entry, i) => (
              <li
                key={i}
                className="rounded border border-highlight/10 px-3 py-1.5 font-mono"
              >
                <div>
                  <span className="data-value">{entry.grant.componentRef}</span> —{' '}
                  {entry.grant.relation}
                </div>
                <div className="mt-1 text-[0.65rem] text-muted-foreground">
                  {entry.sources.map((s, j) => (
                    <span key={j} className="mr-3">
                      {sourceLabel(s)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Active CG-JWTs
// ---------------------------------------------------------------------------

function ActiveCapabilityGrantsSection({ grants }: { grants: ActiveGrantVM[] }) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm">
          Active capability grants ({grants.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No active capability grants. CG-JWTs are minted at mission
            dispatch time and expire shortly after.
          </p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-1.5 pr-3">JTI</th>
                <th className="py-1.5 pr-3">Allowed RPCs</th>
                <th className="py-1.5 pr-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr
                  key={g.jti}
                  className={
                    g.nearExpiry
                      ? 'border-b border-alt/40/30 bg-alt/10/10'
                      : 'border-b border-highlight/10'
                  }
                >
                  <td className="py-1.5 pr-3 font-mono">{g.jti.slice(0, 12)}…</td>
                  <td className="py-1.5 pr-3">{g.allowedRpcs.join(', ')}</td>
                  <td className="py-1.5 pr-3">{formatTime(g.expiresAtUnix)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
