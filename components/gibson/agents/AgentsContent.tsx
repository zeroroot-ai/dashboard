"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { BotIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import {
  AccessScopeSelector,
  type AccessScopeSelection,
} from "@/components/gibson/shared/AccessScopeSelector";
import {
  RWXMatrix,
  type RWXAction,
  type RWXItem,
} from "@/components/gibson/shared/RWXMatrix";
import { LiveConsoleLink } from "@/components/gibson/agent-console/LiveConsoleLink";
import { setComponentAccessAction } from "@/app/actions/crd/access";
import { pickKillSwitch } from "@/components/gibson/shared/kill-switch";
import { grantComponentAction } from "@/app/actions/crd/grant";
import { useCurrentTenant } from "@/src/stores/tenant-store";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { useTierLimits } from "@/src/hooks/useTierLimits";

// Tenant-wide component management is gated on the component-management RPC
// (relation: admin). Non-admins default to the "my-access" scope.
const COMPONENT_MANAGE_RPC =
  "/gibson.tenant.v1.MembershipService/SetComponentAccess";

type Scope = AccessScopeSelection["scope"];

function toMatrixItem(d: DiscoveredItem, scope: Scope): RWXItem {
  const parts: string[] = [];
  if (d.version) parts.push(`v${d.version}`);
  if (d.description) parts.push(d.description);
  return {
    name: d.name,
    displayName: d.displayName ?? d.name,
    description: parts.join(", ") || undefined,
    rwx: d.rwx,
    denyingGates: d.denyingGates,
    killSwitch: pickKillSwitch(d, scope),
    inTenantCatalog: d.inTenantCatalog,
    provenance: d.provenance,
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

export function AgentsContent() {
  const { allowed: canManage, loading: authLoading } =
    useAuthorize(COMPONENT_MANAGE_RPC);
  const { data: tier } = useTierLimits();

  const [scope, setScope] = useState<AccessScopeSelection>({
    scope: "my-access",
  });
  // Once admin authorization resolves, default admins to the tenant-wide
  // scope (one-shot, so a later manual scope change is respected).
  const appliedAdminDefault = useRef(false);
  useEffect(() => {
    if (!authLoading && canManage && !appliedAdminDefault.current) {
      appliedAdminDefault.current = true;
      setScope({ scope: "tenant-wide" });
    }
  }, [authLoading, canManage]);
  const [items, setItems] = useState<RWXItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAccessibleComponentsAction({
      kind: "agent",
      scope: scope.scope,
      targetId: scope.targetId,
    })
      .then((r) => {
        if (cancelled) return;
        if (r.ok) setItems(r.data.map((d) => toMatrixItem(d, scope.scope)));
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
      kind: "agent",
      scope: scope.scope,
      targetId: scope.targetId,
    });
    if (r.ok) setItems(r.data.map((d) => toMatrixItem(d, scope.scope)));
  }

  const tenant = useCurrentTenant();
  async function onEnable(item: RWXItem) {
    if (!tenant) {
      toast.error("No active tenant");
      return;
    }
    const r = await grantComponentAction({
      tenantName: tenant.name,
      componentRef: { kind: "agent", name: item.name },
    });
    if (!r.ok) toast.error(`Enable failed: ${r.error}`);
    await refetch();
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
      componentRef: `component:agent/${item.name}`,
      action,
      enabled,
    });
    if (!r.ok) {
      toast.error(`Toggle failed: ${r.error}`);
      await refetch();
      return;
    }
    // Re-read from the daemon: the switch shows the deny tuple state, and
    // only the daemon knows it (dashboard#1135).
    await refetch();
  }

  const counts = useMemo(() => {
    const total = items.length;
    const readable = items.filter((i) => i.rwx.read).length;
    return { total, readable };
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Agents
        </h1>
        {!loading && (
          <>
            <Badge
              variant="outline"
              className="border-highlight/50 bg-highlight/10/40 text-highlight font-mono tabular-nums"
            >
              {counts.total} total
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted/50 text-muted-foreground font-mono tabular-nums"
            >
              {counts.readable} readable
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
            <AccessScopeSelector value={scope} onChange={setScope} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing the agents currently accessible to you. Tenant admins can
              manage per-team, per-user, and per-agent scopes.
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
            <EmptyState
              icon={BotIcon}
              title="No agents available for this scope"
              description="Agents are the autonomous recon workers that run inside missions. Deploy one to populate this access matrix."
              primaryCta={
                canManage ? (
                  <Button asChild>
                    <Link href="/dashboard/deploy?type=agent">
                      <PlusIcon className="size-4" />
                      Deploy your first agent
                    </Link>
                  </Button>
                ) : undefined
              }
              secondaryCta={
                <Button asChild variant="ghost">
                  {/* prefetch={false}: /docs 307s to the marketing host in
                      SaaS; an RSC prefetch of it dies on CORS (dashboard#963). */}
                  <Link href="/docs/agents" prefetch={false}>
                    Read the docs
                  </Link>
                </Button>
              }
            />
          )}

          {!loading && !error && items.length > 0 && (
            <RWXMatrix
              onEnable={canManage ? onEnable : undefined}
              items={items}
              onToggle={onToggle}
              rowTrailingAction={(it) => (
                <LiveConsoleLink match={{ agentName: it.name }} size="sm" className="h-7 text-xs" />
              )}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
