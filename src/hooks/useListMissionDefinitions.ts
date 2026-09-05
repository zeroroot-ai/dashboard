"use client";

/**
 * useListMissionDefinitions, React Query hook that fetches the list of
 * installed mission definitions from GET /api/missions/definitions.
 *
 * M6, mission-author-experience (Closes #319).
 */

import { useQuery } from "@tanstack/react-query";

export interface MissionDefinitionSummary {
  name: string;
  version: string;
  description: string;
  nodeCount: number;
  installedAt: number | null;
  updatedAt: number | null;
}

async function fetchMissionDefinitions(): Promise<MissionDefinitionSummary[]> {
  const resp = await fetch("/api/missions/definitions", { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(
      `Failed to fetch mission definitions: ${resp.statusText}`,
    );
  }
  const json = await resp.json();
  return json.definitions as MissionDefinitionSummary[];
}

export function useListMissionDefinitions() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["missionDefinitions", "list"] as const,
    queryFn: fetchMissionDefinitions,
    staleTime: 30_000,
  });

  return {
    definitions: data ?? [],
    isLoading,
    error,
    refetch,
  };
}
