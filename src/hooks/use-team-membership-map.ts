"use client";

/**
 * useTeamMembershipMap — loads all teams in the caller's tenant and builds
 * an inverse map `userId → [{ teamId, displayName }, ...]` for fast lookup
 * during user-list render.
 *
 * Two-phase load: listTeamsAction returns every team in the tenant, then
 * listTeamMembersAction fans out per-team. Reasonable for the realistic
 * team count (<50 per tenant; the daemon's default page size).
 * If team count ever scales, the right fix is a daemon-side
 * ListTeamMembershipsByUser RPC that returns the inverse map in one call;
 * filed against gibson if/when the page becomes a hot path.
 *
 * dashboard#150 (S6).
 */

import { useEffect, useState } from "react";

import {
  listTeamsAction,
  listTeamMembersAction,
  type Team,
} from "@/app/actions/crd/teams";

export interface UserTeamMembership {
  teamId: string;
  displayName: string;
}

export interface TeamMembershipMapResult {
  /** userId → array of team memberships (id + display name). */
  byUser: Record<string, UserTeamMembership[]>;
  /** Flat team list — handy for downstream pickers / counts. */
  teams: Team[];
  loading: boolean;
  error: string | null;
}

export function useTeamMembershipMap(): TeamMembershipMapResult {
  const [byUser, setByUser] = useState<Record<string, UserTeamMembership[]>>({});
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const teamsResp = await listTeamsAction();
        if (!teamsResp.ok) throw new Error(teamsResp.error);
        if (cancelled) return;
        setTeams(teamsResp.data);

        const accum: Record<string, UserTeamMembership[]> = {};
        await Promise.all(
          teamsResp.data.map(async (team) => {
            const membersResp = await listTeamMembersAction(team.id);
            if (!membersResp.ok) {
              // Single-team failure shouldn't kill the whole map; the worst
              // case is the chip column under-reports for that one team.
              // Browser-side console.* in hooks is forbidden by
              // check-no-console-in-hooks.mjs so we silently skip; reach for
              // the daemon's audit log if a chip should be present but isn't.
              return;
            }
            for (const m of membersResp.data) {
              if (!accum[m.userId]) accum[m.userId] = [];
              accum[m.userId].push({
                teamId: team.id,
                displayName: team.displayName || team.id,
              });
            }
          }),
        );
        if (cancelled) return;
        setByUser(accum);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { byUser, teams, loading, error };
}
