"use client";

import * as React from "react";
import Link from "next/link";
import { PlusCircle, MoreHorizontal, Play, Pause, Square, Trash2, GripVertical, CrosshairIcon, Pencil } from "lucide-react";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import * as Kanban from "@/components/ui/kanban";

import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { RunDemoMissionButton } from "./RunDemoMissionButton";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { AuthGatedButton } from "@/components/gibson/auth/AuthGatedButton";
import {
  useMissions,
  useStartMission,
  usePauseMission,
  useResumeMission,
  useStopMission,
  useDeleteMission,
} from "@/src/hooks/useMissions";
import type { Mission, MissionStatus } from "@/src/types";

const STATUS_BADGE_CLASSES: Record<MissionStatus, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-primary/50 bg-primary/10 text-primary",
  paused: "border-alt/50 bg-alt/10 text-alt dark:text-alt",
  completed: "border-link/50 bg-link/10 text-link dark:text-link",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  stopped: "border-border text-muted-foreground",
};

const STATUS_LABELS: Record<MissionStatus, string> = {
  pending: "Pending",
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};

const KANBAN_COLUMN_ORDER: MissionStatus[] = [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
];

function StatusBadge({ status }: { status: MissionStatus }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASSES[status]}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function MissionEditButton({ mission }: { mission: Mission }) {
  const { allowed, loading } = useAuthorize(
    "/gibson.daemon.v1.DaemonService/CreateMissionDefinition",
  );

  if (!mission.missionDefinitionId) return null;

  const state = loading ? "loading" : allowed ? "allowed" : "denied";
  const href = `/dashboard/missions/create?definition=${encodeURIComponent(mission.name)}`;

  return (
    <AuthGatedButton
      state={state}
      disabledTooltip="Ask your tenant admin for permission to edit mission definitions."
      variant="ghost"
      size="icon"
      className="size-7"
      loadingSkeletonClassName="size-7 rounded-md"
      asChild={state === "allowed"}
    >
      {state === "allowed" ? (
        <Link href={href}>
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit definition for {mission.name}</span>
        </Link>
      ) : (
        <>
          <Pencil className="size-3.5" />
          <span className="sr-only">Edit definition for {mission.name}</span>
        </>
      )}
    </AuthGatedButton>
  );
}

function MissionActionsMenu({ mission }: { mission: Mission }) {
  const canStart = mission.status === "pending" || mission.status === "paused";
  const canPause = mission.status === "running";
  const canStop = mission.status === "running" || mission.status === "paused";

  const startMutation = useStartMission();
  const pauseMutation = usePauseMission();
  const resumeMutation = useResumeMission();
  const stopMutation = useStopMission();
  const deleteMutation = useDeleteMission();

  function handleStart() {
    startMutation.mutate(mission.id, {
      onSuccess: () => toast.success(`Mission "${mission.name}" started`),
      onError: (err) => toast.error(`Failed to start mission: ${err.message}`),
    });
  }

  function handlePause() {
    pauseMutation.mutate(mission.id, {
      onSuccess: () => toast.success(`Mission "${mission.name}" paused`),
      onError: (err) => toast.error(`Failed to pause mission: ${err.message}`),
    });
  }

  function handleResume() {
    resumeMutation.mutate(mission.id, {
      onSuccess: () => toast.success(`Mission "${mission.name}" resumed`),
      onError: (err) => toast.error(`Failed to resume mission: ${err.message}`),
    });
  }

  function handleStop() {
    stopMutation.mutate(mission.id, {
      onSuccess: () => toast.success(`Mission "${mission.name}" stopped`),
      onError: (err) => toast.error(`Failed to stop mission: ${err.message}`),
    });
  }

  function handleDelete() {
    deleteMutation.mutate(mission.id, {
      onSuccess: () => toast.success(`Mission "${mission.name}" deleted`),
      onError: (err) => toast.error(`Failed to delete mission: ${err.message}`),
    });
  }

  const isWorking =
    startMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    stopMutation.isPending ||
    deleteMutation.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" disabled={isWorking}>
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open actions for {mission.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!canStart || isWorking}
          onClick={mission.status === "paused" ? handleResume : handleStart}
        >
          <Play className="size-4" />
          {mission.status === "paused" ? "Resume" : "Start"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canPause || isWorking} onClick={handlePause}>
          <Pause className="size-4" />
          Pause
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canStop || isWorking} onClick={handleStop}>
          <Square className="size-4" />
          Stop
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={isWorking}
          onClick={handleDelete}
        >
          <Trash2 className="size-4" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MissionsTable({ missions }: { missions: Mission[] }) {
  return (
    <div className="rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Target Scope</TableHead>
            <TableHead className="text-right">Findings</TableHead>
            <TableHead>Created</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {missions.map((mission) => (
            <TableRow key={mission.id}>
              <TableCell className="font-medium font-mono">
                <Link
                  href={`/dashboard/missions/${mission.id}`}
                  className="hover:text-primary transition-colors"
                >
                  {mission.name}
                </Link>
              </TableCell>
              <TableCell>
                <StatusBadge status={mission.status} />
              </TableCell>
              <TableCell className="font-mono text-muted-foreground text-sm">
                {mission.config?.scope ?? mission.config?.target ?? "—"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {mission.findings > 0 ? (
                  <span className="text-primary font-semibold">{mission.findings}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm tabular-nums">
                {mission.startedAt
                  ? new Date(mission.startedAt).toLocaleDateString()
                  : "—"}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1 justify-end">
                  <MissionEditButton mission={mission} />
                  <MissionActionsMenu mission={mission} />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {missions.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                No missions found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function MissionKanbanCard({ mission }: { mission: Mission }) {
  return (
    <Card className="border border-border bg-card shadow-none">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm font-medium font-mono leading-snug">
          <Link
            href={`/dashboard/missions/${mission.id}`}
            className="hover:text-primary transition-colors"
          >
            {mission.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-2">
        <p className="text-xs text-muted-foreground font-mono truncate">
          {mission.config?.scope ?? mission.config?.target ?? "—"}
        </p>
        <div className="flex items-center justify-between gap-1">
          {mission.findings > 0 ? (
            <span className="text-xs text-primary font-semibold tabular-nums">
              {mission.findings} findings
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No findings</span>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {mission.startedAt
              ? new Date(mission.startedAt).toLocaleDateString()
              : "—"}
          </span>
          <MissionEditButton mission={mission} />
        </div>
      </CardContent>
    </Card>
  );
}

function MissionsKanban({ missions }: { missions: Mission[] }) {
  const initialColumns = React.useMemo<Record<string, Mission[]>>(() => {
    const groups: Record<string, Mission[]> = {};
    for (const status of KANBAN_COLUMN_ORDER) {
      groups[status] = [];
    }
    for (const mission of missions) {
      if (KANBAN_COLUMN_ORDER.includes(mission.status as typeof KANBAN_COLUMN_ORDER[number])) {
        groups[mission.status].push(mission);
      }
    }
    return groups;
  }, [missions]);

  const [columns, setColumns] = React.useState(initialColumns);

  // Sync columns when live data changes
  React.useEffect(() => {
    setColumns(initialColumns);
  }, [initialColumns]);

  return (
    <Kanban.Root
      value={columns}
      onValueChange={setColumns}
      getItemValue={(item) => item.id}
    >
      <Kanban.Board className="flex w-full gap-3 overflow-x-auto pb-4 items-start">
        {KANBAN_COLUMN_ORDER.map((status) => {
          const columnMissions = columns[status] ?? [];
          return (
            <Kanban.Column
              key={status}
              value={status}
              className="w-[260px] min-w-[260px] bg-muted/50 border border-border rounded-lg p-2.5"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {STATUS_LABELS[status]}
                  </span>
                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                    {columnMissions.length}
                  </Badge>
                </div>
                <Kanban.ColumnHandle asChild>
                  <Button variant="ghost" size="icon" className="size-6">
                    <GripVertical className="size-3" />
                  </Button>
                </Kanban.ColumnHandle>
              </div>
              <div className="flex flex-col gap-2">
                {columnMissions.map((mission) => (
                  <Kanban.Item key={mission.id} value={mission.id} asHandle asChild>
                    <div>
                      <MissionKanbanCard mission={mission} />
                    </div>
                  </Kanban.Item>
                ))}
                {columnMissions.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No missions
                  </p>
                )}
              </div>
            </Kanban.Column>
          );
        })}
      </Kanban.Board>
      <Kanban.Overlay>
        <div className="bg-primary/10 size-full rounded-md border border-primary/30" />
      </Kanban.Overlay>
    </Kanban.Root>
  );
}

export function MissionsContent() {
  const { data: missions = [], isLoading, error, refetch } = useMissions();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">Missions</h1>
        <div className="flex items-center gap-2">
          <RunDemoMissionButton variant="outline" />
          <Button asChild>
            <Link href="/dashboard/missions/create">
              <PlusCircle className="size-4" />
              New Mission
            </Link>
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <ErrorAlert
          error={error}
          title="Failed to load missions"
          retry={() => refetch()}
        />
      )}

      {/* Loading state */}
      {isLoading && (
        <TableSkeleton rows={5} cols={6} />
      )}

      {/* View Toggle + Content */}
      {!isLoading && !error && missions.length === 0 && (
        <EmptyState
          icon={CrosshairIcon}
          title="No missions yet"
          description="A mission orchestrates one or more agents against a target. Run the one-click demo to see findings flow in, or author your own."
          primaryCta={<RunDemoMissionButton />}
          secondaryCta={
            <Button asChild variant="ghost">
              <Link href="/dashboard/missions/create">
                <PlusCircle className="size-4" />
                Create your own
              </Link>
            </Button>
          }
        />
      )}
      {!isLoading && !error && missions.length > 0 && (
        <Tabs defaultValue="table" className="w-full">
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="kanban">Kanban</TabsTrigger>
          </TabsList>

          <TabsContent value="table" className="mt-4">
            <MissionsTable missions={missions} />
          </TabsContent>

          <TabsContent value="kanban" className="mt-4">
            <MissionsKanban missions={missions} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
