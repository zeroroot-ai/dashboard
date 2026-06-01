"use client";

/**
 * PluginsContent
 * Plugin catalog matrix for Gibson settings. Reuses the shared scope
 * selector + RWXMatrix primitives and preserves the per-plugin Configure
 * button via the matrix's `rowTrailingAction` slot.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { PlugIcon, PlusIcon, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { setComponentAccessAction } from "@/app/actions/crd/access";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

// Tenant-wide component management is gated on the component-management RPC
// (relation: admin). Non-admins default to the "my-access" scope.
const COMPONENT_MANAGE_RPC =
  "/gibson.tenant.v1.MembershipService/SetComponentAccess";
import { useTierLimits } from "@/src/hooks/useTierLimits";

type Scope = AccessScopeSelection["scope"];

interface PluginMatrixItem extends RWXItem {
  configurable: boolean;
  category: string;
}

function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (n === "scope-ingestion" || n === "scope_ingestion") return "Core";
  if (n === "debug-plugin" || n === "debug_plugin") return "Development";
  return "Integration";
}

function inferConfigurable(name: string): boolean {
  return !name.toLowerCase().includes("debug");
}

function toMatrixItem(d: DiscoveredItem): PluginMatrixItem {
  const meta: string[] = [];
  if (d.version) meta.push(`v${d.version}`);
  if (d.description) meta.push(d.description);
  return {
    name: d.name,
    displayName: d.displayName ?? d.name,
    description: meta.join(" — ") || undefined,
    rwx: d.rwx,
    denyingGates: d.denyingGates,
    configurable: inferConfigurable(d.name),
    category: inferCategory(d.name),
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

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  Core: "border-primary/40 bg-primary/10 text-primary",
  Integration:
    "border-link/40 bg-link/10 text-link dark:text-link",
  Development:
    "border-alt/40 bg-alt/10 text-alt dark:text-alt",
};

export function PluginsContent() {
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
  const [items, setItems] = useState<PluginMatrixItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAccessibleComponentsAction({
      kind: "plugin",
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
      kind: "plugin",
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
      componentRef: `component:plugin/${item.name}`,
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

  function handleConfigure(name: string) {
    toast.info(`Plugin configuration for ${name} is not yet available`);
  }

  function renderTrailing(item: RWXItem) {
    const plugin = items.find((p) => p.name === item.name);
    if (!plugin) return null;
    return (
      <div className="flex items-center justify-end gap-2">
        <Badge
          variant="outline"
          className={CATEGORY_BADGE_CLASS[plugin.category] ?? ""}
        >
          {plugin.category}
        </Badge>
        {plugin.configurable && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => handleConfigure(plugin.name)}
            aria-label={`Configure ${plugin.name}`}
          >
            <Settings2 className="size-3.5" />
          </Button>
        )}
      </div>
    );
  }

  const summary = useMemo(() => {
    const total = items.length;
    const executable = items.filter((i) => i.rwx.execute).length;
    return { total, executable };
  }, [items]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Plugins</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Plugins are stateful service integrations with Initialize/Shutdown
          lifecycle hooks. Toggles here write the deny-wins tuples that gate
          per-action access.
        </p>
      </div>

      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Installed plugins</CardTitle>
          <CardDescription className="text-xs">
            {loading
              ? "Loading…"
              : `${summary.executable} of ${summary.total} executable`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-3">
          {canManage ? (
            <AccessScopeSelector value={scope} onChange={setScope} />
          ) : (
            <p className="text-xs text-muted-foreground">
              Showing the plugins currently accessible to you. Tenant admins
              can manage per-team, per-user, and per-agent scopes.
            </p>
          )}

          {error && (
            <ErrorAlert
              error={error}
              title="Unable to load plugin catalog"
              retry={refetch}
            />
          )}

          {loading && !error && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}

          {!loading && !error && items.length === 0 && (
            <EmptyState
              icon={PlugIcon}
              title="No plugins available for this scope"
              description="Plugins are stateful service integrations with Initialize/Shutdown lifecycle hooks. Deploy one to enable per-action access controls here."
              primaryCta={
                canManage ? (
                  <Button asChild>
                    <Link href="/dashboard/deploy?type=plugin">
                      <PlusIcon className="size-4" />
                      Deploy your first plugin
                    </Link>
                  </Button>
                ) : undefined
              }
              secondaryCta={
                <Button asChild variant="ghost">
                  <Link href="/docs/plugins">Read the docs</Link>
                </Button>
              }
            />
          )}

          {!loading && !error && items.length > 0 && (
            <RWXMatrix
              items={items}
              onToggle={onToggle}
              rowTrailingAction={renderTrailing}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
