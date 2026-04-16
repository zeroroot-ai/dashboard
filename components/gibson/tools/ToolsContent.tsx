"use client";

/**
 * ToolsContent
 * Registered security tools panel for the Gibson dashboard.
 */

import * as React from "react";
import Link from "next/link";
import { useSession } from "@/src/lib/session-client";
import { signOutAction } from "@/app/actions/auth/signout";
import { usePermitted } from "@/src/lib/auth/tenant";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import { useTools } from "@/src/hooks/useComponents";
import type { ComponentHealth, ComponentStatus } from "@/src/types";

// ---------------------------------------------------------------------------
// Status badge helpers — mirrors AgentsContent palette
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ComponentStatus, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
  unknown: "Unknown",
};

const STATUS_BADGE_CLASS: Record<ComponentStatus, string> = {
  healthy: "border-green-500/50 bg-green-950/40 text-green-400",
  degraded: "border-amber-500/50 bg-amber-950/40 text-amber-400",
  unhealthy: "border-red-500/50 bg-red-950/40 text-red-400",
  unknown: "border-zinc-500/50 bg-zinc-800/40 text-zinc-400",
};

// ---------------------------------------------------------------------------
// Metadata helpers
// ---------------------------------------------------------------------------

function inferVersion(tool: ComponentHealth): string {
  const meta = tool.metadata;
  if (meta && typeof meta["version"] === "string") return `v${meta["version"]}`;
  return "—";
}

function inferEndpoint(tool: ComponentHealth): string {
  const meta = tool.metadata;
  if (meta && typeof meta["endpoint"] === "string") return meta["endpoint"] as string;
  return "—";
}

function inferDescription(tool: ComponentHealth): string {
  const meta = tool.metadata;
  if (meta && typeof meta["description"] === "string") return meta["description"] as string;
  return "—";
}

// ---------------------------------------------------------------------------
// Loading skeleton row
// ---------------------------------------------------------------------------

function ToolRowSkeleton() {
  return (
    <TableRow>
      <TableCell className="py-3">
        <Skeleton className="h-3.5 w-36" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-12" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20 rounded-full" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-48" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3.5 w-56" />
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ToolsContent() {
  const { data: tools = [], isLoading, isError, error } = useTools();
  const { data: session } = useSession();
  void session; // session available for future use
  const canManage = usePermitted("components:manage");

  const [enabledOverrides, setEnabledOverrides] = React.useState<Record<string, boolean>>({});

  function isEnabled(tool: ComponentHealth): boolean {
    if (tool.id in enabledOverrides) return enabledOverrides[tool.id];
    return tool.status !== "unhealthy";
  }

  async function handleToggle(tool: ComponentHealth, next: boolean) {
    setEnabledOverrides((prev) => ({ ...prev, [tool.id]: next }));
    try {
      const response = await fetch(`/api/tools/${encodeURIComponent(tool.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }
      toast.success(`${tool.name} ${next ? "enabled" : "disabled"}`);
    } catch (err) {
      setEnabledOverrides((prev) => ({ ...prev, [tool.id]: !next }));
      toast.error(`Failed to ${next ? "enable" : "disable"} ${tool.name}`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const enabledCount = tools.filter((t) => isEnabled(t)).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Tools
        </h2>
        {!isLoading && (
          <>
            <Badge
              variant="outline"
              className="border-green-500/50 bg-green-950/40 text-green-400 font-mono tabular-nums"
            >
              {tools.length} total
            </Badge>
            {canManage && (
              <Badge
                variant="outline"
                className="border-zinc-500/50 bg-zinc-800/40 text-zinc-400 font-mono tabular-nums"
              >
                {enabledCount} enabled
              </Badge>
            )}
          </>
        )}
      </div>

      {/* Error state */}
      {isError && (
        <div className="rounded-md border border-red-500/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error instanceof Error ? error.message : "Failed to load tools. Check daemon connectivity."}
        </div>
      )}

      {/* Table */}
      <div className="rounded-md border border-border/60 bg-card/60 backdrop-blur-sm">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Version</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Endpoint</TableHead>
              <TableHead className="text-xs">Description</TableHead>
              {canManage && <TableHead className="w-[100px] text-xs">Enabled</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                <ToolRowSkeleton />
                <ToolRowSkeleton />
                <ToolRowSkeleton />
                <ToolRowSkeleton />
              </>
            ) : tools.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 6 : 5}
                  className="py-12 text-center text-sm text-muted-foreground"
                >
                  <div className="flex flex-col items-center gap-3">
                    <span>No tools registered</span>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/dashboard/deploy?type=tool">Deploy your first tool</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tools.map((tool) => {
                const version = inferVersion(tool);
                const endpoint = inferEndpoint(tool);
                const description = inferDescription(tool);

                return (
                  <TableRow key={tool.id} className="hover:bg-muted/40">
                    <TableCell className="py-3 font-medium">
                      {tool.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {version}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASS[tool.status]}`}
                      >
                        {STATUS_LABEL[tool.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
                      {endpoint}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {description}
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={isEnabled(tool)}
                            onCheckedChange={(checked) => handleToggle(tool, checked)}
                            aria-label={`Toggle ${tool.name}`}
                          />
                          <span className="text-xs text-muted-foreground">
                            {isEnabled(tool) ? "On" : "Off"}
                          </span>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
