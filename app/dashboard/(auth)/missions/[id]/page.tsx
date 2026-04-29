"use client";

import * as React from "react";
import Link from "next/link";
import { use } from "react";
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

const STATUS_BADGE_CLASSES: Record<MissionStatus, string> = {
  pending: "border-border text-muted-foreground",
  running: "border-primary/50 bg-primary/10 text-primary",
  paused: "border-yellow-500/50 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  completed: "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  stopped: "border-border text-muted-foreground",
};

interface MissionDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function MissionDetailPage({ params }: MissionDetailPageProps) {
  const { id } = use(params);
  const { data: mission, isLoading, error, refetch } = useMission(id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="gap-1.5 text-muted-foreground">
            <Link href="/dashboard/missions">
              <ArrowLeft className="size-3.5" />
              Missions
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
            <Link href="/dashboard/missions">
              <ArrowLeft className="size-3.5" />
              Missions
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
          <Link href="/dashboard/missions">
            <ArrowLeft className="size-3.5" />
            Missions
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
            {mission.name}
          </h1>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={STATUS_BADGE_CLASSES[mission.status]}
            >
              {statusLabel}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{mission.id}</span>
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
          <TabsTrigger value="secrets">Secrets</TabsTrigger>
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
        </TabsContent>

        {/* Findings */}
        <TabsContent value="findings" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground font-mono">
                {mission.findings > 0
                  ? `${mission.findings} findings recorded for this mission — findings detail view coming soon.`
                  : "No findings recorded for this mission yet."}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Logs */}
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground font-mono">
                Mission logs — integration pending.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Secrets accessed */}
        <TabsContent value="secrets" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <SecretsAccessedPanel missionId={mission.id} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
