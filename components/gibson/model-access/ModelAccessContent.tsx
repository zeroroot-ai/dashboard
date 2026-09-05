"use client";

/**
 * ModelAccessContent, admin-only UI for managing provider/model grants
 * plus inspecting the model_resolved audit trail.
 *
 * Spec: llm-user-attribution-governance (Requirement 4).
 *
 * Current surface covers the two highest-value use cases:
 *   1. Grant / revoke (provider | model) for a (user | team) subject
 *   2. Audit drawer listing recent model_resolved events
 *
 * The full (user × model) checkbox matrix from design.md is deferred
 * until we have a user/team enumeration RPC, today grants are added
 * one at a time from the form. Dashboard users who need to bulk-grant
 * can script it via the daemon API directly.
 */

import { useEffect, useState } from "react";
import { KeyIcon, ScrollTextIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  grantModelAccessAction,
  revokeModelAccessAction,
  listModelAccessAction,
  listModelAccessAuditAction,
  type AccessGrantRow,
  type ModelResolutionEventRow,
  type SubjectKindInput,
  type TargetKindInput,
} from "@/app/actions/crud/modelAccess";
import { MemberPicker } from "@/components/gibson/model-access/MemberPicker";

export function ModelAccessContent() {
  return (
    <div className="space-y-6">
      <GrantFormCard />
      <GrantsViewerCard />
      <AuditTrailCard />
    </div>
  );
}

// ---------------------------------------------------------------------
// Grant form: add a single (subject, target) grant
// ---------------------------------------------------------------------

function GrantFormCard() {
  const [subjectKind, setSubjectKind] = useState<SubjectKindInput>("user");
  const [subjectId, setSubjectId] = useState("");
  const [targetKind, setTargetKind] = useState<TargetKindInput>("provider");
  const [targetId, setTargetId] = useState("");

  async function grant() {
    const res = await grantModelAccessAction({
      subjectKind,
      subjectId,
      targetKind,
      targetId,
    });
    if (res.ok) {
      toast.success(
        `Granted ${subjectKind}:${subjectId} → ${targetKind}:${targetId}`,
      );
      setSubjectId("");
      setTargetId("");
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Grant model access</CardTitle>
        <CardDescription>
          Grant a user, team, or tenant access to a specific provider or
          model. Without any grants, slot resolution permits all models
          (backwards compatible default); the first grant flips gating
          on for the whole tenant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-4 max-w-4xl">
          <div className="space-y-1.5">
            <Label>Subject kind</Label>
            <Select
              value={subjectKind}
              onValueChange={(v) => setSubjectKind(v as SubjectKindInput)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="tenant">Tenant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subject ID</Label>
            {subjectKind === "user" ? (
              <MemberPicker
                value={subjectId}
                onChange={(userId) => setSubjectId(userId)}
              />
            ) : (
              <Input
                placeholder={
                  subjectKind === "team" ? "team-uuid" : "tenant-uuid"
                }
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Target kind</Label>
            <Select
              value={targetKind}
              onValueChange={(v) => setTargetKind(v as TargetKindInput)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="provider">Provider</SelectItem>
                <SelectItem value="model">Model</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Target ID</Label>
            <Input
              placeholder={
                targetKind === "provider" ? "anthropic" : "claude-opus-4"
              }
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={grant} disabled={!subjectId || !targetId}>
            Grant access
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Grants viewer: look up grants for a specific subject
// ---------------------------------------------------------------------

function GrantsViewerCard() {
  const [subjectKind, setSubjectKind] = useState<SubjectKindInput>("user");
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState<AccessGrantRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!subjectId) return;
    setLoading(true);
    const res = await listModelAccessAction(subjectKind, subjectId);
    if (res.ok) setRows(res.data);
    else toast.error(res.error);
    setLoading(false);
  }

  async function revoke(row: AccessGrantRow) {
    const res = await revokeModelAccessAction({
      subjectKind: row.subjectKind,
      subjectId: row.subjectId,
      targetKind: row.targetKind,
      targetId: row.targetId,
    });
    if (res.ok) {
      toast.success("Grant revoked");
      load();
    } else {
      toast.error(res.error);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>View grants by subject</CardTitle>
        <CardDescription>
          Enumeration requires a subject reference (FGA limitation). Pick a
          user, team, or tenant and press Load.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-end gap-2 mb-4 max-w-xl">
          <div className="flex-1 space-y-1.5">
            <Label>Subject kind</Label>
            <Select
              value={subjectKind}
              onValueChange={(v) => setSubjectKind(v as SubjectKindInput)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">User</SelectItem>
                <SelectItem value="team">Team</SelectItem>
                <SelectItem value="tenant">Tenant</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Subject ID</Label>
            {subjectKind === "user" ? (
              <MemberPicker
                value={subjectId}
                onChange={(userId) => setSubjectId(userId)}
              />
            ) : (
              <Input
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              />
            )}
          </div>
          <Button onClick={load} disabled={!subjectId || loading}>
            Load
          </Button>
        </div>

        {rows.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Target</TableHead>
                <TableHead>Granted at</TableHead>
                <TableHead>Granted by</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.targetKind}-${r.targetId}-${i}`}>
                  <TableCell className="font-mono text-xs">
                    <Badge variant="outline">{r.targetKind}</Badge> {r.targetId}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.grantedAtUnix > 0
                      ? new Date(r.grantedAtUnix * 1000).toLocaleString()
                      : "-"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.grantedByUserId || "-"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => revoke(r)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : subjectId && !loading ? (
          <EmptyState
            icon={KeyIcon}
            title="No grants for this subject"
            description="This subject has no explicit model-access grants. Use the form above to grant access to a specific provider or model."
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Audit trail: last N days of model_resolved events
// ---------------------------------------------------------------------

function AuditTrailCard() {
  const [rows, setRows] = useState<ModelResolutionEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const now = Math.floor(Date.now() / 1000);
      const res = await listModelAccessAuditAction({
        fromUnix: now - 30 * 24 * 3600,
        toUnix: now,
      });
      if (res.ok) setRows(res.data);
      else setError(res.error);
      setLoading(false);
    })();
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail, model resolutions (last 30 days)</CardTitle>
        <CardDescription>
          Every slot resolution, regardless of outcome. Empty rows mean
          the audit backend is not yet wired; events still fire via the
          daemon's stream and will populate here in a follow-up.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">Error: {error}</p>}
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={ScrollTextIcon}
            title="No model resolutions in the last 30 days"
            description="Audit events are emitted every time an agent slot is resolved to a concrete provider/model. Run a mission to populate this trail."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Slot</TableHead>
                <TableHead>Resolved</TableHead>
                <TableHead>Mission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.timestampUnix}-${i}`}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.timestampUnix * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.userId}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.slotName}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.chosenProvider}/{r.chosenModel}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.missionId || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
