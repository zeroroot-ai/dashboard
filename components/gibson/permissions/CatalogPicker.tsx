'use client';

/**
 * CatalogPicker, single source of truth for the catalog-driven grant
 * UI. Used by both the deploy wizard's Permissions step (initial grants
 * at agent / tool creation time) and the agent / tool detail
 * Permissions tab's "Add grant" modal (post-creation grant management).
 *
 * Fetches the tenant catalog from /api/admin/components/catalog (and,
 * for tools, /api/admin/plugins/catalog) and renders one row per
 * catalog entry with action checkboxes. Enabled connectors come from
 * listAccessibleComponentsAction (DiscoveryService.ListConnectors,
 * ADR-0067): a connector is only ever the OBJECT of a grant, the
 * target principal stays an agent / tool / plugin principal, so the
 * picker emits the standard GrantSelection with a
 * `component:connector/<id>` ref. All FGA tuple syntax is hidden
 * behind a "Show technical detail" disclosure to keep the operator
 * surface in plain English.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 3;
 * connector grants: ADR-0067 (dashboard#1128).
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2, RefreshCcw } from 'lucide-react';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';

import { listAccessibleComponentsAction } from '@/app/actions/read/listAccessibleComponents';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CatalogRelation =
  | 'can_read'
  | 'can_configure'
  | 'can_execute'
  | 'can_invoke';

export interface GrantSelection {
  componentRef: string;
  relation: CatalogRelation;
}

interface CatalogPickerProps {
  kind: 'agent' | 'tool';
  selected: GrantSelection[];
  onChange: (next: GrantSelection[]) => void;
  /**
   * Optional grants to exclude from the picker entirely (e.g. grants
   * the principal already has, when used by the Permissions tab's
   * Add-grant modal). The wizard creation flow leaves this empty.
   */
  excludeAlreadyGranted?: GrantSelection[];
}

interface ApiError {
  error: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSelected(selected: GrantSelection[], ref: string, rel: CatalogRelation) {
  return selected.some((s) => s.componentRef === ref && s.relation === rel);
}

function isExcluded(excluded: GrantSelection[] | undefined, ref: string, rel: CatalogRelation) {
  if (!excluded) return false;
  return excluded.some((s) => s.componentRef === ref && s.relation === rel);
}

function toggle(selected: GrantSelection[], ref: string, rel: CatalogRelation): GrantSelection[] {
  if (isSelected(selected, ref, rel)) {
    return selected.filter((s) => !(s.componentRef === ref && s.relation === rel));
  }
  return [...selected, { componentRef: ref, relation: rel }];
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// CatalogPicker
// ---------------------------------------------------------------------------

export function CatalogPicker({
  kind,
  selected,
  onChange,
  excludeAlreadyGranted,
}: CatalogPickerProps) {
  const componentsQ = useQuery({
    queryKey: ['catalog', 'components'],
    queryFn: async () => {
      const r = await fetchJSON<{ components: CatalogPickerEntry[] }>(
        '/api/admin/components/catalog',
      );
      return r.components;
    },
    staleTime: 30_000,
  });

  const pluginsQ = useQuery({
    queryKey: ['catalog', 'plugins'],
    queryFn: async () => {
      const r = await fetchJSON<{ plugins: CatalogPickerEntry[] }>(
        '/api/admin/plugins/catalog',
      );
      return r.plugins;
    },
    staleTime: 30_000,
    enabled: kind === 'tool',
  });

  // Enabled connectors, deny-wins-evaluated by DiscoveryService
  // (ADR-0067). Each row grants against component:connector/<id>.
  const connectorsQ = useQuery({
    queryKey: ['catalog', 'connectors'],
    queryFn: async () => {
      const r = await listAccessibleComponentsAction({ kind: 'connector' });
      if (!r.ok) throw new Error(r.error);
      return r.data.map(
        (d): CatalogPickerEntry => ({
          name: d.displayName ?? d.name,
          ref: `component:connector/${d.name}`,
          description: d.description ?? '',
          version: d.version ?? '',
        }),
      );
    },
    staleTime: 30_000,
  });

  if (componentsQ.isLoading || connectorsQ.isLoading || (kind === 'tool' && pluginsQ.isLoading)) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin mr-2" /> Loading catalog…
      </div>
    );
  }

  if (componentsQ.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>Could not load components catalog</AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="text-xs">{(componentsQ.error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => componentsQ.refetch()}>
            <RefreshCcw className="size-3 mr-1" /> Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const components = componentsQ.data ?? [];
  const connectors = connectorsQ.data ?? [];
  const plugins = pluginsQ.data ?? [];

  const empty =
    components.length === 0 &&
    connectors.length === 0 &&
    !connectorsQ.isError &&
    (kind !== 'tool' || plugins.length === 0);
  if (empty) {
    return (
      <Alert>
        <AlertTitle>Your tenant catalog is empty</AlertTitle>
        <AlertDescription className="text-xs">
          No components or plugins have been published to your tenant
          yet. Ask a tenant admin to publish to the catalog, or proceed
          with minimal access (the agent will inherit tenant-member
          grants only).
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      {/* Components */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs font-medium font-mono uppercase tracking-wider text-muted-foreground">
            Components ({components.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {components.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No components in catalog.
            </p>
          ) : (
            <RwxGrantTable
              nameHeader="Component"
              entries={components}
              selected={selected}
              onChange={onChange}
              excludeAlreadyGranted={excludeAlreadyGranted}
            />
          )}
        </CardContent>
      </Card>

      {/* Connectors (ADR-0067) */}
      <Card>
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs font-medium font-mono uppercase tracking-wider text-muted-foreground">
            Connectors ({connectors.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-[0.65rem] text-muted-foreground">
            Execute lets this {kind} call the connector&apos;s tools. The
            OAuth scope approved at authorization time bounds what
            execute can reach.
          </p>
          {connectorsQ.isError ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>Could not load connectors</AlertTitle>
              <AlertDescription className="space-y-2">
                <p className="text-xs">{(connectorsQ.error as Error).message}</p>
                <Button variant="outline" size="sm" onClick={() => connectorsQ.refetch()}>
                  <RefreshCcw className="size-3 mr-1" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : connectors.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No connectors enabled. Enable one from the Connectors page.
            </p>
          ) : (
            <RwxGrantTable
              nameHeader="Connector"
              entries={connectors}
              selected={selected}
              onChange={onChange}
              excludeAlreadyGranted={excludeAlreadyGranted}
            />
          )}
        </CardContent>
      </Card>

      {/* Plugins (tools only) */}
      {kind === 'tool' && (
        <Card>
          <CardHeader className="pb-2 pt-3">
            <CardTitle className="text-xs font-medium font-mono uppercase tracking-wider text-muted-foreground">
              Plugin invocation ({plugins.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-[0.65rem] text-muted-foreground">
              Plugin invocation is binary (yes / no). Read or write
              gating against a plugin&apos;s data face goes on the
              corresponding component above.
            </p>
            {plugins.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                No plugins in catalog.
              </p>
            ) : (
              <ul className="space-y-1 text-xs">
                {plugins.map((p) => {
                  const rel: CatalogRelation = 'can_invoke';
                  const excluded = isExcluded(excludeAlreadyGranted, p.ref, rel);
                  return (
                    <li
                      key={p.ref}
                      className="flex items-center justify-between rounded border border-highlight/10 px-3 py-1.5"
                    >
                      <span>
                        <span className="font-mono">{p.name}</span>
                        {p.description ? (
                          <span className="ml-2 text-muted-foreground/70">- {p.description}</span>
                        ) : null}
                      </span>
                      <Checkbox
                        checked={isSelected(selected, p.ref, rel)}
                        disabled={excluded}
                        aria-label={`Invoke plugin ${p.name}`}
                        onCheckedChange={() => onChange(toggle(selected, p.ref, rel))}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RwxGrantTable, one row per catalog entry with the three action
// checkboxes. Shared by the Components and Connectors sections; the
// displayed "Write" label maps to the can_configure relation (#1130).
// ---------------------------------------------------------------------------

function RwxGrantTable({
  nameHeader,
  entries,
  selected,
  onChange,
  excludeAlreadyGranted,
}: {
  nameHeader: string;
  entries: CatalogPickerEntry[];
  selected: GrantSelection[];
  onChange: (next: GrantSelection[]) => void;
  excludeAlreadyGranted?: GrantSelection[];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground border-b">
            <th className="py-1.5 pr-3">{nameHeader}</th>
            <th className="py-1.5 px-2 text-center">Read</th>
            {/* Displayed label is "Write"; the underlying relation stays can_configure. */}
            <th className="py-1.5 px-2 text-center">Write</th>
            <th className="py-1.5 px-2 text-center">Execute</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((c) => (
            <tr key={c.ref} className="border-b border-highlight/10">
              <td className="py-1.5 pr-3">
                <div className="font-mono">{c.name}</div>
                {c.description ? (
                  <div className="text-[0.65rem] text-muted-foreground/70">
                    {c.description}
                  </div>
                ) : null}
              </td>
              {(['can_read', 'can_configure', 'can_execute'] as const).map(
                (rel) => {
                  const excluded = isExcluded(excludeAlreadyGranted, c.ref, rel);
                  return (
                    <td key={rel} className="py-1.5 px-2 text-center">
                      <Checkbox
                        checked={isSelected(selected, c.ref, rel)}
                        disabled={excluded}
                        aria-label={`${rel} on ${c.name}`}
                        onCheckedChange={() => onChange(toggle(selected, c.ref, rel))}
                      />
                    </td>
                  );
                },
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface CatalogPickerEntry {
  name: string;
  ref: string;
  description: string;
  version: string;
}

// expose the entry type for consumers if they need it
