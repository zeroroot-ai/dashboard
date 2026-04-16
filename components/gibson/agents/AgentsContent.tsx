"use client";

import * as React from "react";
import Link from "next/link";
import { usePermitted } from "@/src/lib/auth/tenant";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { CardGridSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { useAgents } from "@/src/hooks/useComponents";
import type { ComponentHealth, ComponentStatus } from "@/src/types";
import { toast } from "sonner";

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_DOT: Record<ComponentStatus, React.ReactNode> = {
  healthy: (
    <span
      className="inline-block size-2.5 rounded-full bg-green-400"
      style={{ boxShadow: "0 0 6px rgba(74, 222, 128, 0.8)" }}
      aria-hidden="true"
    />
  ),
  degraded: (
    <span
      className="inline-block size-2.5 rounded-full bg-amber-400 animate-[pulse-dot_1.5s_ease-in-out_infinite]"
      style={{ boxShadow: "0 0 6px rgba(251, 191, 36, 0.8)" }}
      aria-hidden="true"
    />
  ),
  unhealthy: (
    <span
      className="inline-block size-2.5 rounded-full bg-red-500"
      style={{ boxShadow: "0 0 4px rgba(239, 68, 68, 0.5)" }}
      aria-hidden="true"
    />
  ),
  unknown: (
    <span
      className="inline-block size-2.5 rounded-full bg-zinc-500"
      aria-hidden="true"
    />
  ),
};

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

const TYPE_BADGE_CLASS =
  "border-border bg-muted/50 text-muted-foreground font-mono text-xs";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format a Date as a human-readable "X ago" uptime string.
 * Falls back to "—" when no date is provided.
 */
function formatUptime(lastActivity?: Date): string {
  if (!lastActivity) return "—";
  const diffMs = Date.now() - new Date(lastActivity).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "< 1m";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  const remMin = diffMin % 60;
  if (diffHr < 24) return remMin > 0 ? `${diffHr}h ${remMin}m` : `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d`;
}

/**
 * Extract the current task string from component metadata, if present.
 */
function extractCurrentTask(metadata?: Record<string, unknown>): string | null {
  if (!metadata) return null;
  const task = metadata.currentTask ?? metadata.current_task ?? metadata.task;
  return typeof task === "string" && task.length > 0 ? task : null;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  canManage,
  enabled,
  onToggle,
}: {
  agent: ComponentHealth;
  canManage: boolean;
  enabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const currentTask = extractCurrentTask(agent.metadata);
  const uptime = formatUptime(agent.lastActivity);
  const agentType = agent.metadata?.agentType ?? agent.metadata?.agent_type ?? agent.type;

  return (
    <Card className="glass-hack border-0 flex flex-col gap-0 p-0 overflow-hidden">
      <CardHeader className="px-4 pt-4 pb-3 border-b border-green-900/20">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="data-value text-sm leading-snug break-all">
            {agent.name}
          </CardTitle>
          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
            {STATUS_DOT[agent.status]}
            <span className="sr-only">{STATUS_LABEL[agent.status]}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Badge variant="outline" className={TYPE_BADGE_CLASS}>
            {String(agentType)}
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs font-semibold uppercase tracking-wide ${STATUS_BADGE_CLASS[agent.status]}`}
          >
            {STATUS_LABEL[agent.status]}
          </Badge>
          {agent.replicas !== undefined && agent.replicas > 0 && (
            <Badge variant="outline" className={TYPE_BADGE_CLASS}>
              {agent.replicas}x
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 py-3 flex flex-col gap-3 flex-1">
        {/* Current task */}
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wider">
            Current Task
          </p>
          {currentTask ? (
            <p className="text-foreground text-sm leading-snug">{currentTask}</p>
          ) : (
            <p className="text-muted-foreground text-sm italic">Idle</p>
          )}
        </div>

        {/* Last activity / uptime */}
        <div className="flex items-center justify-between mt-auto pt-2 border-t border-green-900/20">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">
            Last Active
          </span>
          <span className="data-value text-xs tabular-nums">{uptime}</span>
        </div>

        {/* Admin access toggle */}
        {canManage && (
          <div className="flex items-center justify-between pt-2 border-t border-green-900/20">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">
              Access
            </span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {enabled ? "On" : "Off"}
              </span>
              <Switch
                checked={enabled}
                onCheckedChange={onToggle}
                aria-label={`Toggle ${agent.name}`}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentsContent() {
  const { data: agents = [], isLoading, error, refetch } = useAgents();
  const canManage = usePermitted("components:manage");

  const [enabledOverrides, setEnabledOverrides] = React.useState<Record<string, boolean>>({});

  function isEnabled(agent: ComponentHealth): boolean {
    if (agent.id in enabledOverrides) return enabledOverrides[agent.id];
    return agent.status !== "unhealthy";
  }

  async function handleToggle(agent: ComponentHealth, next: boolean) {
    setEnabledOverrides((prev) => ({ ...prev, [agent.id]: next }));
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
      }
      toast.success(`${agent.name} ${next ? "enabled" : "disabled"}`);
    } catch (err) {
      setEnabledOverrides((prev) => ({ ...prev, [agent.id]: !next }));
      toast.error(`Failed to ${next ? "enable" : "disable"} ${agent.name}`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  const activeCount = agents.filter(
    (a) => a.status === "healthy" || a.status === "degraded"
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Agents
        </h1>
        {!isLoading && (
          <>
            <Badge
              variant="outline"
              className="border-green-500/50 bg-green-950/40 text-green-400 font-mono tabular-nums"
            >
              {agents.length} total
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted/50 text-muted-foreground font-mono tabular-nums"
            >
              {activeCount} active
            </Badge>
          </>
        )}
      </div>

      {/* Error state */}
      {error && (
        <ErrorAlert
          error={error}
          title="Failed to load agents"
          retry={() => refetch()}
        />
      )}

      {/* Loading state */}
      {isLoading && <CardGridSkeleton count={6} />}

      {/* Agent grid */}
      {!isLoading && !error && agents.length === 0 && (
        <div className="glass-hack rounded-lg py-16 text-center text-sm text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <span>No agents registered.</span>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/deploy?type=agent">Deploy your first agent</Link>
            </Button>
          </div>
        </div>
      )}

      {!isLoading && !error && agents.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              canManage={canManage}
              enabled={isEnabled(agent)}
              onToggle={(checked) => handleToggle(agent, checked)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
