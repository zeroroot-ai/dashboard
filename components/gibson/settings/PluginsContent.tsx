"use client";

/**
 * PluginsContent
 * Plugin management panel for Gibson settings.
 */

import * as React from "react";
import { AlertCircle, Settings2 } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { usePlugins } from "@/src/hooks/useComponents";
import type { ComponentHealth } from "@/src/types";

// ---------------------------------------------------------------------------
// Category badge styling derived from plugin metadata
// ---------------------------------------------------------------------------

const CATEGORY_BADGE_CLASS: Record<string, string> = {
  Core: "border-primary/40 bg-primary/10 text-primary",
  Integration: "border-blue-500/40 bg-blue-500/10 text-blue-500 dark:text-blue-400",
  Development:
    "border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
};

function inferCategory(plugin: ComponentHealth): string {
  const name = plugin.name.toLowerCase();
  if (name === "scope-ingestion" || name === "scope_ingestion") return "Core";
  if (name === "debug-plugin" || name === "debug_plugin") return "Development";
  return "Integration";
}

function inferVersion(plugin: ComponentHealth): string {
  const meta = plugin.metadata;
  if (meta && typeof meta["version"] === "string") return meta["version"] as string;
  return "—";
}

function inferConfigurable(plugin: ComponentHealth): boolean {
  const meta = plugin.metadata;
  if (meta && typeof meta["configurable"] === "boolean") return meta["configurable"] as boolean;
  // Default: configurable unless it's the debug plugin
  return !plugin.name.toLowerCase().includes("debug");
}

// ---------------------------------------------------------------------------
// Loading skeleton row
// ---------------------------------------------------------------------------

function PluginRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="py-3">
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-10" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-12 rounded-full" />
      </TableCell>
      <TableCell />
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export function PluginsContent() {
  const { data: plugins = [], isLoading, isError, error } = usePlugins();

  // Optimistic enabled state: keyed by plugin id
  const [enabledOverrides, setEnabledOverrides] = React.useState<Record<string, boolean>>({});

  function isEnabled(plugin: ComponentHealth): boolean {
    if (plugin.id in enabledOverrides) return enabledOverrides[plugin.id];
    return plugin.status !== "unhealthy";
  }

  async function handleToggle(plugin: ComponentHealth, next: boolean) {
    // Optimistically update local state
    setEnabledOverrides((prev) => ({ ...prev, [plugin.id]: next }));

    try {
      const response = await fetch(`/api/plugins/${encodeURIComponent(plugin.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }

      toast.success(`${plugin.name} ${next ? "enabled" : "disabled"}`);
    } catch (err) {
      // Roll back
      setEnabledOverrides((prev) => ({ ...prev, [plugin.id]: !next }));
      toast.error(`Failed to ${next ? "enable" : "disable"} ${plugin.name}`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  function handleConfigure(plugin: ComponentHealth) {
    // Placeholder — a plugin config dialog would open here
    toast.info(`Plugin configuration for ${plugin.name} is not yet available`);
  }

  const enabledCount = plugins.filter((p) => isEnabled(p)).length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Plugins</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Plugins are stateful service integrations with Initialize/Shutdown lifecycle hooks.
          Changes take effect on the next daemon restart.
        </p>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">
            {error?.message ?? "Failed to load plugins. Check daemon connectivity."}
          </AlertDescription>
        </Alert>
      )}

      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Installed plugins</CardTitle>
          <CardDescription className="text-xs">
            {isLoading ? (
              <Skeleton className="inline-block h-3 w-24" />
            ) : (
              `${enabledCount} of ${plugins.length} enabled`
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-xs">Plugin</TableHead>
                <TableHead className="text-xs">Category</TableHead>
                <TableHead className="text-xs">Version</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="w-20 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <>
                  <PluginRowSkeleton />
                  <PluginRowSkeleton />
                  <PluginRowSkeleton />
                </>
              ) : plugins.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="py-8 text-center text-xs text-muted-foreground"
                  >
                    No plugins registered. Deploy a plugin binary and register it via{" "}
                    <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
                      component.yaml
                    </code>
                    .
                  </TableCell>
                </TableRow>
              ) : (
                plugins.map((plugin) => {
                  const category = inferCategory(plugin);
                  const version = inferVersion(plugin);
                  const configurable = inferConfigurable(plugin);
                  const enabled = isEnabled(plugin);

                  return (
                    <TableRow key={plugin.id} className="hover:bg-muted/40">
                      <TableCell className="py-3">
                        <div>
                          <div className="font-mono text-xs font-medium">{plugin.name}</div>
                          {typeof plugin.metadata?.description === "string" && (
                            <div className="text-muted-foreground mt-0.5 text-xs leading-tight">
                              {plugin.metadata.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={CATEGORY_BADGE_CLASS[category] ?? ""}
                        >
                          {category}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {version !== "—" ? `v${version}` : version}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) => handleToggle(plugin, checked)}
                            aria-label={`Toggle ${plugin.name}`}
                            size="sm"
                          />
                          <span className="text-xs text-muted-foreground">
                            {enabled ? "On" : "Off"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {configurable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => handleConfigure(plugin)}
                            aria-label={`Configure ${plugin.name}`}
                          >
                            <Settings2 className="size-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        To install additional plugins, add the plugin binary to the cluster and register it via{" "}
        <code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">component.yaml</code>.
      </p>
    </div>
  );
}
