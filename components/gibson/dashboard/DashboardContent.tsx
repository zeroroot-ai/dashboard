'use client';

import { AlertTriangle, Bot, ChevronRight, Crosshair, Network, Plug, Wrench } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ErrorAlert, KPICardsSkeleton, TableSkeleton } from '@/components/gibson/shared';
import { useAgents, useTools, usePlugins } from '@/src/hooks/useComponents';
import { useFindings, useFindingsCounts } from '@/src/hooks/useFindings';
import { useMissions } from '@/src/hooks/useMissions';
import { useEventStream } from '@/src/hooks/useEventStream';
import { useUIStore } from '@/src/stores/ui-store';
import type { Finding, FindingSeverity, Mission, MissionStatus } from '@/src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

const SEVERITY_STYLES: Record<FindingSeverity, string> = {
  critical: 'bg-red-950 text-red-400 border-red-800',
  high:     'bg-orange-950 text-orange-400 border-orange-800',
  medium:   'bg-yellow-950 text-yellow-400 border-yellow-800',
  low:      'bg-blue-950 text-blue-400 border-blue-800',
  info:     'bg-zinc-900 text-zinc-400 border-zinc-700',
};

const STATUS_STYLES: Record<MissionStatus, string> = {
  running:   'bg-green-950 text-green-400 border-green-800',
  paused:    'bg-yellow-950 text-yellow-400 border-yellow-800',
  completed: 'bg-blue-950 text-blue-400 border-blue-800',
  failed:    'bg-red-950 text-red-400 border-red-800',
  stopped:   'bg-zinc-900 text-zinc-400 border-zinc-700',
  pending:   'bg-zinc-900 text-zinc-300 border-zinc-700',
};

function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono uppercase tracking-wider ${SEVERITY_STYLES[severity]}`}
    >
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: MissionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-mono uppercase tracking-wider ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConnectionBanner() {
  useEventStream(); // starts SSE connection to /api/events/stream
  const connectionStatus = useUIStore((state) => state.connectionStatus);
  const isConnected = connectionStatus === 'connected';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full rounded border px-4 py-2 text-center text-sm font-mono font-medium tracking-wide ${
        isConnected
          ? 'border-green-800 bg-green-950 text-green-400'
          : 'border-red-800 bg-red-950 text-red-400'
      }`}
    >
      {isConnected ? (
        <>
          <span className="mr-2 inline-block h-2 w-2 animate-[pulse-dot_1.5s_ease-in-out_infinite] rounded-full bg-green-500 align-middle" />
          Connected to Zero Day AI
        </>
      ) : (
        <>
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-500 align-middle" />
          Connection Lost &mdash; Retrying...
        </>
      )}
    </div>
  );
}

function KpiCards() {
  const { data: missions } = useMissions();
  const { data: findingsPage } = useFindings({}, { limit: 50 });
  const { data: counts } = useFindingsCounts();
  const { data: agents } = useAgents();

  const activeMissions = (missions ?? []).filter((m) => m.status === 'running').length;
  const totalFindings = findingsPage?.total ?? 0;
  const criticalFindings = counts?.critical ?? 0;
  const agentsOnline = agents?.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {/* Active Missions */}
      <Card className="glass-hack border-green-900/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Active Missions
            </CardTitle>
            <Crosshair className="h-4 w-4 text-green-500 opacity-70" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="data-value text-3xl font-bold">{activeMissions}</p>
        </CardContent>
      </Card>

      {/* Total Findings */}
      <Card className="glass-hack border-green-900/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Total Findings
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-green-500 opacity-70" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2">
            <p className="data-value text-3xl font-bold">{totalFindings}</p>
            <Badge
              className="mb-0.5 border-red-800 bg-red-950 font-mono text-red-400"
              variant="outline"
            >
              {criticalFindings} crit
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Agents Online */}
      <Card className="glass-hack border-green-900/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Agents Online
            </CardTitle>
            <Bot className="h-4 w-4 text-green-500 opacity-70" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="data-value text-3xl font-bold">{agentsOnline}</p>
        </CardContent>
      </Card>

      {/* Graph Nodes — not yet backed by a hook; shows 0 until graph hook is wired */}
      <Card className="glass-hack border-green-900/40">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
              Graph Nodes
            </CardTitle>
            <Network className="h-4 w-4 text-green-500 opacity-70" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent>
          <p className="data-value text-3xl font-bold">0</p>
        </CardContent>
      </Card>
    </div>
  );
}

function RecentFindings() {
  const { data, isLoading, error, refetch } = useFindings({}, { limit: 5 });
  const findings = data?.data ?? [];

  if (isLoading) {
    return (
      <Card className="glass-hack border-green-900/40">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            Recent Findings
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <TableSkeleton rows={5} cols={4} />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-hack border-green-900/40">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            Recent Findings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorAlert error={error} title="Failed to load findings" retry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-hack border-green-900/40">
      <CardHeader>
        <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Recent Findings
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow className="border-green-900/30 hover:bg-transparent">
              <TableHead className="pl-6 text-xs font-mono uppercase text-muted-foreground">
                Severity
              </TableHead>
              <TableHead className="text-xs font-mono uppercase text-muted-foreground">
                Title
              </TableHead>
              <TableHead className="text-xs font-mono uppercase text-muted-foreground">
                Target
              </TableHead>
              <TableHead className="pr-6 text-xs font-mono uppercase text-muted-foreground">
                When
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {findings.length === 0 ? (
              <TableRow className="border-green-900/20 hover:bg-transparent">
                <TableCell colSpan={4} className="py-8 text-center">
                  <p className="font-mono text-sm text-muted-foreground">0 findings</p>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    Run a mission to discover vulnerabilities
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              findings.map((finding) => (
                <TableRow
                  key={finding.id}
                  className="border-green-900/20 hover:bg-green-950/20"
                >
                  <TableCell className="pl-6">
                    <SeverityBadge severity={finding.severity} />
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-sm text-foreground">
                    {finding.title}
                  </TableCell>
                  <TableCell>
                    <span className="data-value text-xs">{finding.affectedAssets[0]}</span>
                  </TableCell>
                  <TableCell className="pr-6 font-mono text-xs text-muted-foreground">
                    {timeAgo(new Date(finding.discoveredAt))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MissionStatusPanel() {
  const { data, isLoading, error, refetch } = useMissions();
  const recent = (data ?? []).slice(0, 3);

  if (isLoading) {
    return (
      <Card className="glass-hack border-green-900/40">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            Mission Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TableSkeleton rows={3} cols={2} />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-hack border-green-900/40">
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            Mission Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorAlert error={error} title="Failed to load missions" retry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-hack border-green-900/40">
      <CardHeader>
        <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
          Mission Status
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {recent.length === 0 ? (
          <div className="py-6 text-center">
            <p className="font-mono text-sm text-muted-foreground">0 missions</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              No missions have been executed yet
            </p>
          </div>
        ) : (
          recent.map((mission) => (
            <div
              key={mission.id}
              className="flex items-center justify-between gap-3 rounded border border-green-900/20 bg-green-950/10 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{mission.name}</p>
                {/* Progress bar */}
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-green-900/30">
                  <div
                    className="h-full rounded-full bg-green-500/60 transition-all"
                    style={{ width: `${mission.progress ?? 0}%` }}
                    role="progressbar"
                    aria-valuenow={mission.progress ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${mission.name} progress`}
                  />
                </div>
              </div>
              <StatusBadge status={mission.status} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ComponentCards() {
  const { data: agents } = useAgents();
  const { data: tools } = useTools();
  const { data: plugins } = usePlugins();

  const cards = [
    {
      title: 'Agents',
      href: '/dashboard/agents',
      icon: Bot,
      total: agents?.length ?? 0,
      healthy: (agents ?? []).filter((a) => a.status === 'healthy').length,
      description: 'Autonomous LLM-driven workers',
    },
    {
      title: 'Tools',
      href: '/dashboard/tools',
      icon: Wrench,
      total: tools?.length ?? 0,
      healthy: (tools ?? []).filter((t) => t.status === 'healthy').length,
      description: 'Stateless security tool workers',
    },
    {
      title: 'Plugins',
      href: '/dashboard/plugins',
      icon: Plug,
      total: plugins?.length ?? 0,
      healthy: (plugins ?? []).filter((p) => p.status === 'healthy').length,
      description: 'Stateful service integrations',
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {cards.map((card) => (
        <Link key={card.title} href={card.href} className="group">
          <Card className="glass-hack border-green-900/40 transition-colors group-hover:border-green-700/60">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <card.icon className="h-4 w-4 text-green-500 opacity-70" aria-hidden="true" />
                  <CardTitle className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
                    {card.title}
                  </CardTitle>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-end justify-between">
                <div>
                  <p className="data-value text-2xl font-bold">{card.total}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                </div>
                <Badge
                  className="mb-0.5 border-green-800 bg-green-950 font-mono text-green-400"
                  variant="outline"
                >
                  {card.healthy} healthy
                </Badge>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function DashboardContent() {
  // Aggregate loading / error state across the two primary data sources
  const { isLoading: missionsLoading, error: missionsError, refetch: refetchMissions } = useMissions();
  const { isLoading: findingsLoading, error: findingsError, refetch: refetchFindings } = useFindings({}, { limit: 5 });

  const isLoading = missionsLoading || findingsLoading;
  const firstError = missionsError ?? findingsError;

  return (
    <div className="bg-grid-hack min-h-full space-y-6 p-1">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          <span className="text-green-500/70">&gt;</span> Console
        </h1>
        <span className="font-mono text-xs text-muted-foreground">
          {new Date().toUTCString()}
        </span>
      </div>

      {/* Connection status */}
      <ConnectionBanner />

      {/* Top-level error banner when both data sources fail */}
      {firstError && !isLoading && (
        <ErrorAlert
          error={firstError}
          title="Dashboard data unavailable"
          retry={() => {
            void refetchMissions();
            void refetchFindings();
          }}
        />
      )}

      {/* KPI row */}
      {isLoading ? <KPICardsSkeleton /> : <KpiCards />}

      {/* Component cards — Agents, Tools, Plugins */}
      <ComponentCards />

      {/* Activity split */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentFindings />
        </div>
        <div className="lg:col-span-2">
          <MissionStatusPanel />
        </div>
      </div>
    </div>
  );
}
