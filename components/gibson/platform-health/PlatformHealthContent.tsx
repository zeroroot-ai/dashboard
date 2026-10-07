// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The platform health view of the Platform owner (hosted#174). Each line is
 * one plane that the daemon probed now. A secret source that stopped
 * answering is red here, while every pod still runs on the Secrets written
 * earlier. The view polls, so it turns red without a reload.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleHelp, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatformHealthAction } from "@/app/actions/platform-health";
import { PLATFORM_HEALTH_TEXTS as T } from "./texts";
import type { PlaneHealthView } from "./types";

export const PLATFORM_HEALTH_QUERY_KEY = ["platform-health"] as const;

function StateIcon({ state }: { state: PlaneHealthView["state"] }) {
  if (state === "healthy") return <CheckCircle2 className="size-5 text-highlight" aria-hidden="true" />;
  if (state === "unhealthy") return <XCircle className="size-5 text-destructive" aria-hidden="true" />;
  return <CircleHelp className="size-5 text-muted-foreground" aria-hidden="true" />;
}

function PlaneRow({ plane }: { plane: PlaneHealthView }) {
  return (
    <li data-testid={`plane-${plane.plane}`} data-state={plane.state} className="space-y-1 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StateIcon state={plane.state} />
        <span className="font-medium">{T.planes[plane.plane] ?? plane.plane}</span>
        <Badge variant={plane.state === "unhealthy" ? "destructive" : "outline"}>{T.state[plane.state]}</Badge>
        {plane.checkedAtUnix > 0 && (
          <span className="text-xs text-muted-foreground">
            {T.checkedAt} {new Date(plane.checkedAtUnix * 1000).toLocaleString()}
          </span>
        )}
      </div>
      {plane.detail && <p className="font-mono text-xs text-muted-foreground">{plane.detail}</p>}
      {plane.state === "unhealthy" && plane.plane === "secret_plane" && (
        <p className="text-xs text-muted-foreground">{T.secretPlaneHint}</p>
      )}
    </li>
  );
}

export function PlatformHealthContent() {
  const { data, isLoading } = useQuery({
    queryKey: PLATFORM_HEALTH_QUERY_KEY,
    queryFn: () => getPlatformHealthAction(),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{T.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{T.intro}</p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted-foreground">…</p>}
        {data && !data.ok && <p className="text-sm text-destructive">{T.loadError}</p>}
        {data?.ok && (
          <ul className="space-y-2">
            {data.data.map((p) => (
              <PlaneRow key={p.plane} plane={p} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
