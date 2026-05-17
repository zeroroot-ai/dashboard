"use client";

/**
 * Teams management surface — create / rename / delete teams and manage
 * membership. Reuses existing UsersContent row patterns for consistency
 * with the rest of the Organization settings section.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 35, R8 AC 3-5.
 */
import { useState, useEffect } from "react";
import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { toast } from "sonner";
import {
  createTeamAction,
  deleteTeamAction,
  listTeamsAction,
  type Team,
} from "@/app/actions/crd/teams";

export function TeamsContent() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    const r = await listTeamsAction();
    if (r.ok) setTeams(r.data);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function onCreate() {
    if (!newId.trim() || !newName.trim()) {
      toast.error("Team id + display name are required.");
      return;
    }
    setCreating(true);
    const r = await createTeamAction({ teamId: newId.trim(), displayName: newName.trim() });
    if (r.ok) {
      toast.success(`Team ${r.data.displayName} created.`);
      setNewId("");
      setNewName("");
      await refresh();
    } else {
      toast.error(`Create failed: ${r.error}`);
    }
    setCreating(false);
  }

  async function onDelete(t: Team) {
    if (!confirm(`Delete team ${t.displayName}? Removes all member/admin/deny tuples.`)) return;
    const r = await deleteTeamAction(t.id);
    if (r.ok) {
      toast.success(`Team ${t.displayName} deleted.`);
      await refresh();
    } else {
      toast.error(`Delete failed: ${r.error}`);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create team</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <label className="text-xs uppercase text-muted-foreground">Team ID</label>
            <Input
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="red-team"
              className="font-mono"
              disabled={creating}
            />
          </div>
          <div className="flex-1">
            <label className="text-xs uppercase text-muted-foreground">Display name</label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Red Team"
              disabled={creating}
            />
          </div>
          <Button onClick={onCreate} disabled={creating}>
            {creating ? "Creating…" : "Create team"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : teams.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No teams yet"
              description="Teams group members within your tenant. Use per-team denies in Security Policy to restrict access to specific plugins, tools, or agents."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead className="w-28 text-right">Members</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.displayName}</div>
                      <div className="font-mono text-xs text-muted-foreground">{t.id}</div>
                    </TableCell>
                    <TableCell className="text-right">{t.memberCount}</TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/dashboard/organization/teams/${encodeURIComponent(t.id)}`}>
                          Manage
                        </Link>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(t)}>
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
