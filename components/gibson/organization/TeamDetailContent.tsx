"use client";

/**
 * Team detail surface, roster, add member, remove member, toggle admin,
 * delete team. Backed by gibson PlatformOperatorService.ListTeamMembers
 * + WriteAccessTuples (via add/remove/deleteTeamMember server actions).
 *
 * dashboard#148. Companion to the Teams list at
 * /dashboard/organization/teams. Layout follows the existing Organization
 * pages, Card-per-section, EmptyState fallback when roster is empty.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/gibson/shared/EmptyState";

import {
  addTeamMemberAction,
  deleteTeamAction,
  listTeamMembersAction,
  removeTeamMemberAction,
  type TeamMember,
} from "@/app/actions/crd/teams";
import { setTeamAdminAction } from "@/app/actions/crd/role";

interface Props {
  teamId: string;
}

export function TeamDetailContent({ teamId }: Props) {
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUserId, setNewUserId] = useState("");
  const [addAsAdmin, setAddAsAdmin] = useState(false);

  async function refresh() {
    setLoading(true);
    const r = await listTeamMembersAction(teamId);
    if (r.ok) setMembers(r.data);
    else toast.error(`Failed to load members: ${r.error}`);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onAdd() {
    const userId = newUserId.trim();
    if (!userId) {
      toast.error("User ID is required.");
      return;
    }
    setAdding(true);
    const r = await addTeamMemberAction({ teamId, userId, asAdmin: addAsAdmin });
    if (r.ok) {
      toast.success(
        `Added ${userId} as ${addAsAdmin ? "admin" : "member"}.`,
      );
      setNewUserId("");
      setAddAsAdmin(false);
      await refresh();
    } else {
      toast.error(`Add failed: ${r.error}`);
    }
    setAdding(false);
  }

  async function onRemove(m: TeamMember) {
    if (
      !confirm(
        `Remove ${m.email || m.userId} from team ${teamId}? They keep their tenant membership.`,
      )
    )
      return;
    const r = await removeTeamMemberAction({ teamId, userId: m.userId });
    if (r.ok) {
      toast.success(`Removed ${m.userId} from team ${teamId}.`);
      await refresh();
    } else {
      toast.error(`Remove failed: ${r.error}`);
    }
  }

  async function onToggleAdmin(m: TeamMember) {
    // Single-tuple flip of the `admin` relation, no touch on `member` -
    // setTeamAdminAction is the proper fix for the remove+re-add dance the
    // earlier version used (dashboard#148 → #168).
    const r = await setTeamAdminAction({
      teamId,
      userId: m.userId,
      isAdmin: !m.isAdmin,
    });
    if (!r.ok) {
      toast.error(
        `${m.isAdmin ? "Demote" : "Promote"} failed: ${r.error}`,
      );
    } else {
      toast.success(
        m.isAdmin
          ? `Demoted ${m.userId} to member.`
          : `Promoted ${m.userId} to admin.`,
      );
    }
    await refresh();
  }

  async function onDeleteTeam() {
    if (
      !confirm(
        `Delete team ${teamId}? This removes every member/admin/deny tuple referencing it. Members keep their tenant access, only their team binding goes away.`,
      )
    )
      return;
    const r = await deleteTeamAction(teamId);
    if (r.ok) {
      toast.success(`Team ${teamId} deleted.`);
      router.push("/dashboard/organization/teams");
    } else {
      toast.error(`Delete failed: ${r.error}`);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/organization/teams"
        className="inline-flex items-center gap-2 text-sm text-link hover:underline"
      >
        <ArrowLeftIcon className="size-4" />
        Back to teams
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Team: {teamId}</h1>
        <p className="text-sm text-muted-foreground">
          Manage the roster, admin status, and lifecycle of this team. Per-team
          denies for plugins, tools, and agents live in{" "}
          <Link href="/dashboard/organization/security-policy" className="underline">
            Security policy
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add member</CardTitle>
          <CardDescription>
            Adds an existing tenant member to this team. The user must already
            be a tenant member (invite them via{" "}
            <Link href="/dashboard/organization/users" className="underline">
              Users
            </Link>{" "}
            first).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="text-xs uppercase text-muted-foreground">User ID</label>
            <Input
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              placeholder="zitadel-numeric-sub-or-uuid"
              className="font-mono"
              disabled={adding}
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={addAsAdmin}
              onChange={(e) => setAddAsAdmin(e.target.checked)}
              disabled={adding}
            />
            Add as admin
          </label>
          <Button onClick={onAdd} disabled={adding}>
            {adding ? "Adding…" : "Add member"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roster</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No members yet"
              description="Add an existing tenant member above to give them access to per-team denies on plugins, tools, and agents."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="w-28">Role</TableHead>
                  <TableHead className="w-56" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="font-medium">
                        {m.email || m.displayName || m.userId}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {m.userId}
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.isAdmin ? (
                        <Badge variant="default">Admin</Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onToggleAdmin(m)}
                      >
                        {m.isAdmin ? "Demote" : "Promote to admin"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onRemove(m)}>
                        Remove
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Deleting a team removes every member, admin, and per-team-deny
            tuple referencing it. Members keep their tenant access, only the
            team binding goes away. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={onDeleteTeam}>
            Delete team
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
