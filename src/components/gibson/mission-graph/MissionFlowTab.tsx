"use client";

/**
 * MissionFlowTab, the run page's "Flow" view. Loads the daemon-projected
 * MissionGraph + saved layout version, gates drag/save on the SaveMissionLayout
 * authz check, and renders MissionFlow. While a run is in flight it subscribes
 * to the mission event stream and paints completed nodes / traversed edges live
 * as the daemon emits per-node lifecycle events; a completed run paints its
 * final traversed path.
 *
 * Spec: MissionGraph epic, dashboard#655 / #657 / #658, gibson#604 (live).
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
import {
  applyNodeEvent,
  newAccumulator,
  toRunSignals,
  type NodePhase,
} from "./run-signals";

const FGA_SAVE_LAYOUT = "/gibson.daemon.v1.DaemonService/SaveMissionLayout";

export interface MissionFlowTabProps {
  /** The mission *run* id, keys the live node-event stream. */
  missionId: string;
  missionDefinitionId?: string;
  missionStatus: MissionStatus;
}

export function MissionFlowTab({
  missionId,
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

  // Live per-node overlay: while the run can still progress, subscribe to the
  // mission event stream (`event: node` frames forwarded from the daemon's
  // Subscribe RPC) and fold each lifecycle event into RunSignals. A finished
  // run has no further events to stream, so its overlay is derived from status
  // in the memo below.
  const [liveSignals, setLiveSignals] = React.useState<RunSignals | null>(null);

  React.useEffect(() => {
    if (!missionId) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    const terminal =
      missionStatus === "completed" ||
      missionStatus === "failed" ||
      missionStatus === "stopped";
    if (terminal) return;

    let es: EventSource;
    try {
      es = new EventSource(
        `/api/missions/${encodeURIComponent(missionId)}/events`,
      );
    } catch {
      return;
    }

    const acc = newAccumulator();
    const onNode = (e: MessageEvent) => {
      try {
        const { nodeId, phase } = JSON.parse(e.data) as {
          nodeId?: string;
          phase?: NodePhase;
        };
        if (!nodeId || !phase) return;
        applyNodeEvent(acc, { nodeId, phase });
        setLiveSignals(toRunSignals(acc));
      } catch {
        // ignore malformed frames
      }
    };
    es.addEventListener("node", onNode);

    return () => {
      es.removeEventListener("node", onNode);
      es.close();
    };
  }, [missionId, missionStatus]);

  const runSignals: RunSignals | undefined = React.useMemo(() => {
    // A completed run shows its final traversed path: every node completed.
    if (missionStatus === "completed" && graph) {
      return { completedNodeIds: graph.nodes.map((n) => n.id) };
    }
    // Otherwise paint whatever the live node stream has accumulated so far.
    return liveSignals ?? undefined;
  }, [missionStatus, graph, liveSignals]);

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
