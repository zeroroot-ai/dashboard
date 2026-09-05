"use client";

/**
 * useOrgGraph, single source of truth for the tenant's team graph.
 *
 * Loads `listTeamsAction` once and fans out `listTeamMembersAction` per
 * team, then derives two views from the same data:
 *
 *   - `teams` , flat array of every Team in the tenant
 *   - `byTeam`, { teamId → TeamMember[] }
 *   - `byUser`, { userId → [{ teamId, displayName }, ...] }
 *
 * Wrapped in React Query so navigating between the users list and any
 * user detail page in the same session hits the daemon once. 60-second
 * staleTime matches the membership query elsewhere in the dashboard;
 * the team graph changes slowly enough that this is comfortable.
 *
 * Replaces the previous `useTeamMembershipMap` (S6) and the inline
 * per-user fetcher inside `UserTeamMembershipsEditor` (S7). The
 * inverse-map work happens once; both consumers slice their own view
 * from the result. dashboard#174.
 */

import { useQuery } from "@tanstack/react-query";

import {
  listTeamsAction,
  listTeamMembersAction,
  type Team,
  type TeamMember,
} from "@/app/actions/crd/teams";
import { useTenantId } from "@/src/lib/auth/tenant";
import { queryKeys } from "@/src/lib/query/keys";

export interface UserTeamMembership {
  teamId: string;
  displayName: string;
}

interface OrgGraph {
  teams: Team[];
  byUser: Record<string, UserTeamMembership[]>;
  byTeam: Record<string, TeamMember[]>;
}

interface UseOrgGraphResult {
  data: OrgGraph;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const EMPTY_GRAPH: OrgGraph = { teams: [], byUser: {}, byTeam: {} };

async function fetchOrgGraph(): Promise<OrgGraph> {
  const teamsResp = await listTeamsAction();
  if (!teamsResp.ok) throw new Error(teamsResp.error);

  const byUser: Record<string, UserTeamMembership[]> = {};
  const byTeam: Record<string, TeamMember[]> = {};

  await Promise.all(
    teamsResp.data.map(async (team) => {
      const membersResp = await listTeamMembersAction(team.id);
      if (!membersResp.ok) {
        // Single-team failure shouldn't kill the whole map; consumers will
        // see an under-reported chip/picker. check-no-console-in-hooks
        // rejects raw console.* so we silently skip; the daemon's audit
        // log is the right place to diagnose persistent fetch failures.
        byTeam[team.id] = [];
        return;
      }
      byTeam[team.id] = membersResp.data;
      for (const m of membersResp.data) {
        if (!byUser[m.userId]) byUser[m.userId] = [];
        byUser[m.userId].push({
          teamId: team.id,
          displayName: team.displayName || team.id,
        });
      }
    }),
  );

  return { teams: teamsResp.data, byUser, byTeam };
}

export function useOrgGraph(): UseOrgGraphResult {
  const tenantId = useTenantId() ?? "";
  const query = useQuery({
    queryKey: queryKeys.orgGraph.full(tenantId),
    queryFn: fetchOrgGraph,
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  return {
    data: query.data ?? EMPTY_GRAPH,
    loading: query.isLoading,
    error: query.error
      ? query.error instanceof Error
        ? query.error.message
        : String(query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
  };
}
