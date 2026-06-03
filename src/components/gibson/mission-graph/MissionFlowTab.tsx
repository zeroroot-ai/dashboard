"use client";

/**
 * MissionFlowTab — the run page's "Flow" view. Loads the daemon-projected
 * MissionGraph + saved layout version, gates drag/save on the SaveMissionLayout
 * authz check, and renders MissionFlow. A completed run paints its final
 * traversed path; live per-node overlay awaits daemon node-stream events
 * (tracked separately).
 *
 * Spec: MissionGraph epic — dashboard#655 / #657 / #658.
 */

import * as React from "react";

import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import {
  getMissionGraphAction,
  getMissionLayoutVersionAction,
  type MissionGraphData,
} from "@/app/actions/missions/mission-graph";
import type { MissionStatus } from "@/src/types";
import { MissionFlow } from "./MissionFlow";
import type { RunSignals } from "./overlay";

const FGA_SAVE_LAYOUT = "/gibson.daemon.v1.DaemonService/SaveMissionLayout";

export interface MissionFlowTabProps {
  missionDefinitionId?: string;
  missionStatus: MissionStatus;
}

export function MissionFlowTab({
  missionDefinitionId,
  missionStatus,
}: MissionFlowTabProps) {
  // Hide-on-loading: treat the save affordance as unavailable while the
  // membership query is in flight, so drag/save never flashes for a user who
  // turns out to be unauthorized.
  const { allowed, loading: authzLoading } = useAuthorize(FGA_SAVE_LAYOUT);
  const canSave = allowed && !authzLoading;

  const [graph, setGraph] = React.useState<MissionGraphData | null>(null);
  const [version, setVersion] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!missionDefinitionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const [g, v] = await Promise.all([
          getMissionGraphAction(missionDefinitionId),
          getMissionLayoutVersionAction(missionDefinitionId),
        ]);
        if (cancelled) return;
        setGraph(g);
        setVersion(v);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load mission graph",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missionDefinitionId]);

  // A completed run shows its final traversed path: every node completed.
  // Live, in-flight per-node overlay requires daemon node-stream events that
  // are not yet emitted; until then the running view is the static graph.
  const runSignals: RunSignals | undefined = React.useMemo(() => {
    if (missionStatus === "completed" && graph) {
      return { completedNodeIds: graph.nodes.map((n) => n.id) };
    }
    return undefined;
  }, [missionStatus, graph]);

  if (!missionDefinitionId) {
    return (
      <p className="text-sm text-muted-foreground">
        This run was not created from a registered mission definition, so it has
        no flow-chart.
      </p>
    );
  }
  if (loading) return <TableSkeleton />;
  if (error) return <ErrorAlert error={{ message: error }} />;
  if (!graph || graph.nodes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No mission graph is available for this definition.
      </p>
    );
  }

  return (
    <MissionFlow
      graph={graph}
      missionDefinitionId={missionDefinitionId}
      initialLayoutVersion={version}
      runSignals={runSignals}
      canSave={canSave}
    />
  );
}
