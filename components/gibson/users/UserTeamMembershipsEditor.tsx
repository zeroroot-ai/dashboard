"use client";

/**
 * UserTeamMembershipsEditor — per-user multi-select team-membership panel
 * on the user detail page. Lists every team in the tenant and lets admins
 * toggle the user's membership + admin status on each team.
 *
 * Each row has two controls:
 *   - "Member" checkbox: toggles add/removeTeamMemberAction (member relation).
 *   - "Admin" checkbox: toggles setTeamAdminAction (admin relation only).
 *     Disabled when the user isn't a member.
 *
 * Optimistic updates: each control flips local state immediately, fires the
 * server action, and rolls back local state on error (toast notifies).
 * Read-only when canEdit is false (non-admin viewer).
 *
 * dashboard#151 (S7).
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { UsersIcon } from "lucide-react";

import {
  addTeamMemberAction,
  listTeamMembersAction,
  listTeamsAction,
  removeTeamMemberAction,
  type Team,
} from "@/app/actions/crd/teams";
import { setTeamAdminAction } from "@/app/actions/crd/role";

interface RowState {
  team: Team;
  /** True iff the user is on this team's roster (member or admin). */
  isMember: boolean;
  /** True iff the user holds the admin relation on this team. */
  isAdmin: boolean;
  /** Per-row in-flight flag; disables both controls while true. */
  pending: boolean;
}

interface Props {
  userId: string;
  /** True when the caller can mutate the user's memberships. */
  canEdit: boolean;
}

export function UserTeamMembershipsEditor({ userId, canEdit }: Props) {
  const [rows, setRows] = useState<RowState[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const teamsResp = await listTeamsAction();
        if (!teamsResp.ok) throw new Error(teamsResp.error);
        if (cancelled) return;

        const built: RowState[] = await Promise.all(
          teamsResp.data.map(async (team) => {
            const membersResp = await listTeamMembersAction(team.id);
            if (!membersResp.ok) {
              return { team, isMember: false, isAdmin: false, pending: false };
            }
            const m = membersResp.data.find((mm) => mm.userId === userId);
            return {
              team,
              isMember: !!m,
              isAdmin: !!m?.isAdmin,
              pending: false,
            };
          }),
        );
        if (cancelled) return;
        setRows(built);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  function updateRow(teamId: string, patch: Partial<RowState>) {
    setRows((prev) =>
      prev
        ? prev.map((r) => (r.team.id === teamId ? { ...r, ...patch } : r))
        : prev,
    );
  }

  async function toggleMember(row: RowState, next: boolean) {
    if (row.pending) return;
    const prev = { isMember: row.isMember, isAdmin: row.isAdmin };
    // Optimistic flip. Removing membership also drops admin (the parent
    // relation `member` going away cascades semantically).
    updateRow(row.team.id, {
      pending: true,
      isMember: next,
      isAdmin: next ? row.isAdmin : false,
    });
    try {
      const res = next
        ? await addTeamMemberAction({
            teamId: row.team.id,
            userId,
            asAdmin: false,
          })
        : await removeTeamMemberAction({ teamId: row.team.id, userId });
      if (!res.ok) throw new Error(res.error ?? "failed");
      toast.success(
        next
          ? `Added to ${row.team.displayName}.`
          : `Removed from ${row.team.displayName}.`,
      );
    } catch (err) {
      // Roll back to previous state on failure.
      updateRow(row.team.id, { isMember: prev.isMember, isAdmin: prev.isAdmin });
      toast.error(
        `${next ? "Add" : "Remove"} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      updateRow(row.team.id, { pending: false });
    }
  }

  async function toggleAdmin(row: RowState, next: boolean) {
    if (row.pending || !row.isMember) return;
    const prev = row.isAdmin;
    updateRow(row.team.id, { pending: true, isAdmin: next });
    try {
      const res = await setTeamAdminAction({
        teamId: row.team.id,
        userId,
        isAdmin: next,
      });
      if (!res.ok) throw new Error(res.error ?? "failed");
      toast.success(
        next
          ? `Promoted to admin in ${row.team.displayName}.`
          : `Demoted to member in ${row.team.displayName}.`,
      );
    } catch (err) {
      updateRow(row.team.id, { isAdmin: prev });
      toast.error(
        `${next ? "Promote" : "Demote"} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      updateRow(row.team.id, { pending: false });
    }
  }

  return (
    <Card className="glass-hack border-0">
      <CardHeader className="pb-3">
        <CardTitle className="font-mono text-base">Team memberships</CardTitle>
        <CardDescription>
          Per-team membership + admin status. Members inherit per-team denies
          from Security policy; admins additionally manage the team roster.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">
            Failed to load teams: {error}
          </p>
        ) : rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No teams in this tenant yet"
            description="Create a team on the Teams page before assigning memberships."
          />
        ) : (
          <ul className="divide-y divide-border" data-testid="team-memberships-list">
            {rows.map((row) => (
              <li
                key={row.team.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{row.team.displayName}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {row.team.id}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={row.isMember}
                      disabled={!canEdit || row.pending}
                      onCheckedChange={(c) =>
                        toggleMember(row, c === true)
                      }
                      aria-label={`${row.isMember ? "Remove from" : "Add to"} ${row.team.displayName}`}
                    />
                    <span className="text-xs text-muted-foreground">Member</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={row.isAdmin}
                      disabled={!canEdit || row.pending || !row.isMember}
                      onCheckedChange={(c) =>
                        toggleAdmin(row, c === true)
                      }
                      aria-label={`${row.isAdmin ? "Demote in" : "Promote in"} ${row.team.displayName}`}
                    />
                    <span className="text-xs text-muted-foreground">Admin</span>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
