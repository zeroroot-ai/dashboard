"use client";

/**
 * /dashboard/missions/definitions/[name], mission definition detail page.
 *
 * Fetches a single mission definition via GET /api/missions/definitions/[name]
 * (DaemonService.GetMissionDefinition M5 RPC) and renders it via
 * MissionDefinitionDetail, which surfaces every author-facing field from the
 * MissionDefinition proto (constraints, workspace, per-node policies, all
 * config oneof variants).
 *
 * M6, mission-author-experience. Closes #187.
 */

import * as React from "react";
import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import { ErrorAlert } from "@/components/gibson/shared";
import { MissionDefinitionDetail } from "@/src/components/mission-definition/MissionDefinitionDetail";
import { useMissionDefinition } from "@/src/hooks/useMissionDefinition";

interface PageProps {
  params: Promise<{ name: string }>;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export default function MissionDefinitionDetailPage({ params }: PageProps) {
  const { name } = use(params);
  const { data: definition, isLoading, error, refetch } = useMissionDefinition(name);

  return (
    <div className="space-y-4">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1.5 text-muted-foreground"
        >
          <Link href="/dashboard/missions">
            <ArrowLeft className="size-3.5" />
            Missions
          </Link>
        </Button>
      </div>

      {isLoading && <LoadingSkeleton />}

      {!isLoading && error && (
        <ErrorAlert
          error={error}
          title="Failed to load mission definition"
          retry={() => refetch()}
        />
      )}

      {!isLoading && !error && definition && (
        <>
          {/* Header */}
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight font-mono lg:text-2xl">
              {definition.name || name}
            </h1>
            {definition.description && (
              <p className="text-sm text-muted-foreground">{definition.description}</p>
            )}
            {definition.version && (
              <p className="text-xs text-muted-foreground font-mono">v{definition.version}</p>
            )}
          </div>

          <MissionDefinitionDetail definition={definition} />
        </>
      )}

      {!isLoading && !error && !definition && (
        <div className="text-sm text-muted-foreground">Mission definition not found.</div>
      )}
    </div>
  );
}
