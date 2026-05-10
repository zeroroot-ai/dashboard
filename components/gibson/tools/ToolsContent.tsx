"use client";

/**
 * ToolsContent
 * Shared deny-wins matrix for the Gibson Tools catalog. Reuses the shared
 * AccessScopeSelector + RWXMatrix primitives so the scope/admin semantics
 * match the Agents and Plugins pages exactly. Tool-specific metadata
 * (version / endpoint) rides on the matrix row's description slot so the
 * visual parity with the legacy table layout is preserved.
 */

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared";
import {
  AccessScopeSelector,
  type AccessScopeSelection,
} from "@/components/gibson/shared/AccessScopeSelector";
import {
  RWXMatrix,
  type RWXAction,
  type RWXItem,
} from "@/components/gibson/shared/RWXMatrix";
import { setComponentAccessAction } from "@/app/actions/crd/access";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";
import { usePermitted } from "@/src/lib/auth/tenant";
import { useTierLimits } from "@/src/hooks/useTierLimits";

type Scope = AccessScopeSelection["scope"];

function toMatrixItem(d: DiscoveredItem): RWXItem {
  const meta: string[] = [];
  if (d.version) meta.push(`v${d.version}`);
  if (d.description) meta.push(d.description);
  return {
    name: d.name,
    displayName: d.displayName ?? d.name,
    description: meta.join(" — ") || undefined,
    rwx: d.rwx,
    denyingGates: d.denyingGates,
  };
}

function scopeParam(
  s: Scope,
): "tenant" | "team" | "user" | "component" | "my" | null {
  switch (s) {
    case "tenant-wide":
      return "tenant";
    case "per-team":
      return "team";
    case "per-user":
      return "user";
    case "per-agent":
      return "component";
    case "my-access":
      return "my";
    default:
      return null;
  }
}

export function ToolsContent() {
  const canManage = usePermitted("components:manage");
  const { data: tier } = useTierLimits();
  const isProsumer = false // removed by spec plans-and-quotas-simplification;

  const [scope, setScope] = useState<AccessScopeSelection>({
    scope: canManage ? "tenant-wide" : "my-access",
  });
  const [items, setItems] = useState<RWXItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAccessibleComponentsAction({
      kind: "tool",
      scope: scope.scope,
      targetId: scope.targetId,
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setItems(r.data.map(toMatrixItem));
        else setError(new Error(r.error));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  async function refetch() {
    const r = await listAccessibleComponentsAction({
      kind: "tool",
      scope: scope.scope,
      targetId: scope.targetId,
    });
    if (r.ok) setItems(r.data.map(toMatrixItem));
  }

  async function onToggle(
    item: RWXItem,
    action: RWXAction,
    enabled: boolean,
  ) {
    const s = scopeParam(scope.scope);
    if (!s) return;
    const r = await setComponentAccessAction({
      scope: s,
      targetId: scope.targetId,
      componentRef: `component:tool/${item.name}`,
      action,
      enabled,
    });
    if (!r.ok) {
      toast.error(`Toggle failed: ${r.error}`);
      await refetch();
      return;
    }
    setItems((prev) =>
      prev.map((it) =>
        it.name === item.name
          ? { ...it, rwx: { ...it.rwx, [action]: enabled } }
          : it,
      ),
    );
  }

  const counts = useMemo(() => {
    const total = items.length;
    const executable = items.filter((i) => i.rwx.execute).length;
    return { total, executable };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Tools
        </h2>
        {!loading && (
          <>
            <Badge
              variant="outline"
              className="border-green-500/50 bg-green-950/40 text-green-400 font-mono tabular-nums"
            >
              {counts.total} total
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted/50 text-muted-foreground font-mono tabular-nums"
            >
              {counts.executable} executable
            </Badge>
          </>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access matrix</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage ? (
            <AccessScopeSelector
              value={scope}
              onChange={setScope}
              disablePerTeam={isProsumer}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing the tools currently accessible to you. Tenant admins can
              manage per-team, per-user, and per-agent scopes.
            </p>
          )}

          {isProsumer && canManage && scope.scope === "per-team" && (
            <p className="text-xs text-muted-foreground">
              Upgrade for team policies.
            </p>
          )}

          {error && (
            <ErrorAlert
              error={error}
              title="Unable to load catalog state"
              retry={refetch}
            />
          )}

          {loading && !error && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {!loading && !error && items.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No tools available for this scope.
            </p>
          )}

          {!loading && !error && items.length > 0 && (
            <RWXMatrix items={items} onToggle={onToggle} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
