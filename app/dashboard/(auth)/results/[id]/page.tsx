"use client";

import * as React from "react";
import Link from "next/link";
import { use } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { useMission } from "@/src/hooks/useMissions";
import type { MissionStatus } from "@/src/types";
import { SecretsAccessedPanel } from "@/src/components/missions/SecretsAccessedPanel";
import { CheckpointTimeline } from "@/src/components/mission/CheckpointTimeline";
import { CheckpointBadge } from "@/src/components/mission/CheckpointBadge";
import { ToolStreamProgress } from "@/src/components/mission/ToolStreamProgress";
import { MissionFindingsTab } from "@/components/gibson/missions/MissionFindingsTab";
import { MissionTracesTab } from "@/components/gibson/missions/MissionTracesTab";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import type { CheckpointMetadata } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";

const MissionTerminal = dynamic(
  () =>
    import("@/src/components/missions/MissionTerminal").then(
      (m) => m.MissionTerminal,
    ),
  { ssr: false },
);

/**
 * In-flight tool tracking for `<ToolStreamProgress />`.
 *
 * The mission events SSE bridge at `/api/missions/:id/events` emits
 * `tool_started` / `tool_completed` frames as tools enter and leave the
 * orchestrator's act loop. Each frame's payload carries an
 * `invocationId` (the daemon-side `WorkID` keyed into the per-tool
 * stream ring buffer) and the tool's display name. We model the live
 * set with a Map keyed by `invocationId` so a tool that is dispatched
 * twice in quick succession produces two side-by-side progress bars.
 *
 * When the daemon's MissionStream lands (currently a placeholder, see
 * `/api/missions/:id/events/route.ts`), the same shape applies — the
 * route forwards each `tool_started` / `tool_completed` event verbatim
 * and the page's listener handles the set transitions identically.
 *
 * Spec: week-4-handlers-ui-e2e §5 task 53 (per-tool streaming progress
 *       on the mission detail page).
 */
interface InFlightTool {
  invocationId: string;
  toolName: string;
}

const STATUS_BADGE_CLASSES: Record<MissionStatus, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-primary/50 bg-primary/10 text-primary",
  paused: "border-alt/50 bg-alt/10 text-alt dark:text-alt",
  completed: "border-link/50 bg-link/10 text-link dark:text-link",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  stopped: "border-border text-muted-foreground",
};

interface MissionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function MissionDetailPage({ params }: MissionDetailPageProps) {
  const { id } = use(params);
  const { data: mission, isLoading, error, refetch } = useMission(id);

  // FGA gating for the Checkpoints tab — viewer is required to even see
  // the tab. Spec week-4-handlers-ui-e2e §4 task 40 / R17.1.
  const { allowed: canViewCheckpoints, loading } = useAuthorize(
    "/gibson.daemon.v1.DaemonService/ListCheckpoints",
  );

  // Surfaced after a Resume; populated by the CheckpointRewindModal when
  // the daemon's first ResumeMissionResponse carries a checkpoint
  // metadata payload. Spec mission-checkpointing R9.3.
  const [resumeMetadata, _setResumeMetadata] =
    React.useState<CheckpointMetadata | null>(null);
  const resumed =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("resumed") === "1";

  // Live "currently executing tools" set for `<ToolStreamProgress />`.
  // Map<invocationId, InFlightTool>; using a Map (rather than a Set of
  // tuples) keeps the React render path stable when the same tool is
  // re-dispatched. Spec week-4-handlers-ui-e2e §5 task 53.
  const [currentlyExecutingTools, setCurrentlyExecutingTools] =
    React.useState<Map<string, InFlightTool>>(new Map());

  // Ref for the Logs tab terminal. Populated on mount; the log-fetch effect
  // below writes entries once the ref is attached (xterm.js is client-only,
  // hence MissionTerminal is dynamically imported with ssr: false).
  const logsTerminalRef = React.useRef<MissionTerminalHandle>(null);

  React.useEffect(() => {
    const terminal = logsTerminalRef.current;
    if (!terminal) return;

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(
          `/api/missions/${encodeURIComponent(id)}/logs`,
        );
        if (cancelled) return;

        if (!res.ok) {
          terminal.write(
            "\x1b[33mLog service is not available. Try again later.\x1b[0m\r\n",
          );
          return;
        }

        const data = (await res.json()) as
          | {
              available: true;
              entries: {
                timestamp: string;
                level: string;
                message: string;
                component: string;
              }[];
            }
          | { available: false; message?: string };

        if (cancelled) return;

        if (!data.available) {
          terminal.write(
            "\x1b[33mLog service is not available. Try again later.\x1b[0m\r\n",
          );
          return;
        }

        if (data.entries.length === 0) {
          terminal.write(
            "\x1b[2mNo log entries for this mission.\x1b[0m\r\n",
          );
          return;
        }

        const levelPrefix: Record<string, string> = {
          error: "\x1b[31m[ERR]\x1b[0m",
          warn: "\x1b[33m[WRN]\x1b[0m",
          info: "\x1b[36m[INF]\x1b[0m",
          debug: "\x1b[2m[DBG]\x1b[0m",
        };

        for (const entry of data.entries) {
          const prefix = levelPrefix[entry.level] ?? "\x1b[2m[   ]\x1b[0m";
          const ts = new Date(entry.timestamp).toLocaleTimeString();
          terminal.write(`${prefix} ${ts} ${entry.message}\r\n`);
        }
      } catch {
        if (!cancelled) {
          terminal.write(
            "\x1b[33mLog service is not available. Try again later.\x1b[0m\r\n",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on mount when the ref is attached; id is stable for the
    // lifetime of this page instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return;

    let cancelled = false;
    const url = `/api/missions/${encodeURIComponent(id)}/events`;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch {
      return;
    }

    const onToolStarted = (ev: MessageEvent) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(ev.data) as {
          invocationId?: string;
          toolName?: string;
        };
        if (!payload?.invocationId || !payload?.toolName) return;
        setCurrentlyExecutingTools((prev) => {
          if (prev.has(payload.invocationId!)) return prev;
          const next = new Map(prev);
          next.set(payload.invocationId!, {
            invocationId: payload.invocationId!,
            toolName: payload.toolName!,
          });
          return next;
        });
      } catch {
        // ignore malformed frames
      }
    };

    const onToolCompleted = (ev: MessageEvent) => {
      if (cancelled) return;
      try {
        const payload = JSON.parse(ev.data) as { invocationId?: string };
        if (!payload?.invocationId) return;
        setCurrentlyExecutingTools((prev) => {
          if (!prev.has(payload.invocationId!)) return prev;
          const next = new Map(prev);
          next.delete(payload.invocationId!);
          return next;
        });
      } catch {
        // ignore malformed frames
      }
    };

    es.addEventListener("tool_started", onToolStarted);
    es.addEventListener("tool_completed", onToolCompleted);

    return () => {
      cancelled = true;
      es.removeEventListener("tool_started", onToolStarted);
      es.removeEventListener("tool_completed", onToolCompleted);
      es.close();
    };
  }, [id]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
            <Link href="/dashboard/results">
              <ArrowLeft className="size-3.5" />
              Results
            </Link>
          </Button>
        </div>
        <TableSkeleton rows={4} cols={3} />
      </div>
    );
  }

  if (error || !mission) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
            <Link href="/dashboard/results">
              <ArrowLeft className="size-3.5" />
              Results
            </Link>
          </Button>
        </div>
        <ErrorAlert
          error={error ?? new Error("Mission not found")}
          title="Failed to load mission"
          retry={() => refetch()}
        />
      </div>
    );
  }

  const statusLabel =
    mission.status.charAt(0).toUpperCase() + mission.status.slice(1);

  const targetScope =
    mission.config?.scope ?? mission.config?.target ?? "—";

  const createdDisplay = mission.startedAt
    ? new Date(mission.startedAt).toLocaleDateString()
    : "—";

  const completedDisplay = mission.completedAt
    ? new Date(mission.completedAt).toLocaleDateString()
    : null;

  return (
    <div className="space-y-4">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
          <Link href="/dashboard/results">
            <ArrowLeft className="size-3.5" />
            Results
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
            {mission.name}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={STATUS_BADGE_CLASSES[mission.status]}
            >
              {statusLabel}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{mission.id}</span>
            {(resumed || resumeMetadata) && (
              <CheckpointBadge checkpointMetadata={resumeMetadata} />
            )}
          </div>
        </div>
      </div>

      <Separator />

      {/* Detail Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="findings">
            Findings
            {mission.findings > 0 && (
              <Badge
                variant="outline"
                className="ml-1.5 px-1.5 py-0 h-4 text-xs border-primary/40 text-primary"
              >
                {mission.findings}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="traces">Traces</TabsTrigger>
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
          {!loading && canViewCheckpoints && (
            <TabsTrigger value="checkpoints">Checkpoints</TabsTrigger>
          )}
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Mission Name
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-medium font-mono">{mission.name}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Badge
                  variant="outline"
                  className={STATUS_BADGE_CLASSES[mission.status]}
                >
                  {statusLabel}
                </Badge>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Target Scope
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono text-primary">{targetScope}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Started
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono tabular-nums">{createdDisplay}</p>
              </CardContent>
            </Card>

            {completedDisplay && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                    Completed
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-mono tabular-nums">{completedDisplay}</p>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Findings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-semibold font-mono tabular-nums text-primary">
                  {mission.findings}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Progress
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm font-mono tabular-nums">{mission.progress}%</p>
              </CardContent>
            </Card>

            {mission.agents.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                    Agents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm font-mono">{mission.agents.join(", ")}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {mission.config?.description && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Description
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {mission.config.description}
                </p>
              </CardContent>
            </Card>
          )}

          {/* In-flight tool streaming progress — week-4-handlers-ui-e2e §5
              task 53. One <ToolStreamProgress /> per active invocation. The
              set is fed by the mission events SSE bridge's tool_started /
              tool_completed frames; entries are removed automatically when
              the daemon emits tool_completed (or the per-tool stream
              terminates). */}
          {currentlyExecutingTools.size > 0 && (
            <Card className="mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  In-Flight Tools
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Array.from(currentlyExecutingTools.values()).map((tool) => (
                  <ToolStreamProgress
                    key={tool.invocationId}
                    missionId={mission.id}
                    invocationId={tool.invocationId}
                    toolName={tool.toolName}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Findings */}
        <TabsContent value="findings" className="mt-4">
          <MissionFindingsTab missionId={mission.id} />
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs" className="mt-4">
          <div style={{ height: "400px" }}>
            <MissionTerminal
              ref={logsTerminalRef}
              title="Mission Logs"
              defaultOpen={true}
            />
          </div>
        </TabsContent>

        {/* Traces */}
        <TabsContent value="traces" className="mt-4">
          <MissionTracesTab missionId={mission.id} missionStatus={mission.status} />
        </TabsContent>

        {/* Secrets accessed */}
        <TabsContent value="secrets" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <SecretsAccessedPanel missionId={mission.id} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Checkpoints — week-4-handlers-ui-e2e §4 R17.1 */}
        {canViewCheckpoints && (
          <TabsContent value="checkpoints" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                <CheckpointTimeline missionId={mission.id} />
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
