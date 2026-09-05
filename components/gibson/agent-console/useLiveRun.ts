"use client";

/**
 * Finds a live run for a mission or an agent (dashboard#1145), so other
 * pages can link to that run's console pane.
 */

import { useRunningAgents } from "@/src/hooks/useRunningAgents";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";

export type LiveRunMatch = { missionId: string } | { agentName: string };

/** Picks the first run that matches, oldest first as the list is sorted. */
export function findLiveRun(
  agents: readonly RunningAgentView[] | undefined,
  match: LiveRunMatch,
): RunningAgentView | undefined {
  if (!agents) return undefined;
  if ("missionId" in match) {
    return match.missionId ? agents.find((a) => a.missionId === match.missionId) : undefined;
  }
  return match.agentName ? agents.find((a) => a.agentName === match.agentName) : undefined;
}

/** Console deep link for a run. */
export function consoleHref(runId: string): string {
  return `/dashboard/sandboxes?run=${encodeURIComponent(runId)}`;
}

/** The live run for a mission or an agent, if any, from the polled list. */
export function useLiveRun(match: LiveRunMatch): RunningAgentView | undefined {
  const { data } = useRunningAgents();
  return findLiveRun(data, match);
}
