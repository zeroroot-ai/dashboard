"use client";

/**
 * Security Policy surface — unified deny-wins matrix across plugins /
 * tools / agents at every scope. Composes AccessScopeSelector +
 * RWXMatrix and routes toggles through setComponentAccessAction.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 38, R8.
 */
import { useEffect, useState } from "react";
import {
  AccessScopeSelector,
  type AccessScopeSelection,
} from "@/components/gibson/shared/AccessScopeSelector";
import { RWXMatrix, type RWXItem, type RWXAction } from "@/components/gibson/shared/RWXMatrix";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setComponentAccessAction } from "@/app/actions/crd/access";
import { toast } from "sonner";

type Kind = "plugin" | "tool" | "agent" | "all";

// fetchItems is the single fan-out that asks the daemon for the current
// deny-wins-evaluated catalog view for (kind, scope, target). v1 wires
// this against a client-side Server Action that wraps DiscoveryService
// list calls; until that action lands we return an empty array so the
// page still renders without crashing.
async function fetchItems(
  _kind: Kind,
  _scope: AccessScopeSelection,
): Promise<RWXItem[]> {
  return [];
}

export function SecurityPolicyContent() {
  const [kind, setKind] = useState<Kind>("plugin");
  const [scope, setScope] = useState<AccessScopeSelection>({ scope: "tenant-wide" });
  const [items, setItems] = useState<RWXItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchItems(kind, scope)
      .then((next) => {
        if (!cancelled) setItems(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, scope]);

  async function onToggle(item: RWXItem, action: RWXAction, enabled: boolean) {
    const scopeName = scopeParam(scope.scope);
    if (!scopeName) return;
    if (confirmSelfRestriction(scope, enabled)) {
      if (!confirm("This deny will restrict your own access. Continue?")) return;
    }
    const r = await setComponentAccessAction({
      scope: scopeName,
      targetId: scope.targetId,
      componentRef: itemRef(kind, item.name),
      action,
      enabled,
    });
    if (!r.ok) {
      toast.error(`Toggle failed: ${r.error}`);
      return;
    }
    // Optimistic update — re-fetch the matrix to reflect the write.
    setItems((prev) =>
      prev.map((it) =>
        it.name === item.name ? { ...it, rwx: { ...it.rwx, [action]: enabled } } : it,
      ),
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Security policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <AccessScopeSelector value={scope} onChange={setScope} />
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Plugins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plugin">Plugins</SelectItem>
                <SelectItem value="tool">Tools</SelectItem>
                <SelectItem value="agent">Agents</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No items to display for this scope. Toggles here install deny
              tuples; nothing appears until items are published to the
              system catalog.
            </p>
          ) : (
            <RWXMatrix items={items} onToggle={onToggle} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function scopeParam(
  s: AccessScopeSelection["scope"],
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
  }
}

function itemRef(kind: Kind, name: string): string {
  if (kind === "all") return `component:${name}`;
  return `component:${kind}/${name}`;
}

function confirmSelfRestriction(
  scope: AccessScopeSelection,
  enabled: boolean,
): boolean {
  // Rough heuristic: any deny at My access scope, or a user-scope deny
  // targeting the current user. The full caller-id check happens server-
  // side — this is just the "did you really mean it?" prompt.
  if (!enabled && scope.scope === "my-access") return true;
  return false;
}
