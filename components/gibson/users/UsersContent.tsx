"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "@/src/lib/session-client";
import { usePermitted, useTenantId } from "@/src/lib/auth/tenant";
import { MoreHorizontal, Search, Trash2, UserPlus, Eye, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { InviteUserDialog } from "./InviteUserDialog";
import { TeamMembershipChips } from "./TeamMembershipChips";
import { useCRDWatch } from "@/src/hooks/useCRDWatch";
import { useOrgGraph } from "@/src/hooks/use-org-graph";
import { revokeMemberAction, resendInvitationAction } from "@/app/actions/crd/member";
import { setTenantRoleAction } from "@/app/actions/crd/role";
import type { TenantMember } from "@/src/lib/k8s/types";

// ── Styles ────────────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner: "border-alt/50 bg-alt/10 text-alt",
  admin: "border-primary/50 bg-primary/10 text-primary",
  member: "border-link/50 bg-link/10/20 text-link",
  viewer: "border-border bg-muted/50 text-muted-foreground",
};

function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UserActionsMenu({
  member,
  canEdit,
  isSelf,
  isOwner,
  onRemove,
  onResend,
  onCancel,
}: {
  member: TenantMember;
  canEdit: boolean;
  isSelf: boolean;
  isOwner: boolean;
  onRemove: (member: TenantMember) => void;
  onResend: (member: TenantMember) => void;
  onCancel: (member: TenantMember) => void;
}) {
  const userId = member.status?.userId ?? member.metadata.name;
  const isInvited = member.status?.phase === "Invited";
  const canRemove = canEdit && !isSelf && !isOwner;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open actions for {member.spec.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/organization/users/${userId}`}>
            <Eye className="size-4" />
            View Details
          </Link>
        </DropdownMenuItem>
        {canRemove && isInvited && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onResend(member)}>
              <Mail className="size-4" />
              Resend invitation
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onCancel(member)}
            >
              <XCircle className="size-4" />
              Cancel invitation
            </DropdownMenuItem>
          </>
        )}
        {canRemove && !isInvited && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onRemove(member)}
            >
              <Trash2 className="size-4" />
              Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function UsersContent() {
  const { data: session } = useSession();
  const tenantId = useTenantId() ?? "";
  const currentUserId = session?.user?.id ?? "";
  const canEdit = usePermitted("team:manage");

  const namespace = tenantId ? tenantNamespace(tenantId) : undefined;

  const { items, status, error } = useCRDWatch("TenantMember", namespace, {
    enabled: !!tenantId,
  });

  const { data: orgGraph, loading: teamsLoading } = useOrgGraph();
  const teamsByUser = orgGraph.byUser;

  const [search, setSearch] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<TenantMember | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [memberToCancel, setMemberToCancel] = React.useState<TenantMember | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  // Local optimistic role overrides. The displayed role badge reads from
  // member.spec.role normally, but setTenantRoleAction writes FGA tuples
  // directly — the spec.role field is not updated by the operator yet.
  // We track local overrides so the dropdown reflects the change without
  // requiring a page reload. The mismatch between spec.role and the FGA
  // tuple persists across reloads until a TenantMember-side reconciler
  // (or a corresponding patchTenantMember call) is added — filed as a
  // known follow-up.
  const [roleOverrides, setRoleOverrides] = React.useState<Record<string, "admin" | "member">>({});
  const [pendingRole, setPendingRole] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((m) =>
      m.spec.email.toLowerCase().includes(q)
    );
  }, [items, search]);

  async function handleRoleChange(member: TenantMember, role: "admin" | "member") {
    const userId = member.status?.userId ?? member.metadata.name;
    setPendingRole((prev) => ({ ...prev, [userId]: true }));
    try {
      const res = await setTenantRoleAction({ userId, role });
      if (!res.ok) throw new Error(res.error ?? "failed");
      setRoleOverrides((prev) => ({ ...prev, [userId]: role }));
      toast.success(`${member.spec.email} is now ${role}.`);
    } catch (err) {
      toast.error(
        `Failed to change role: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPendingRole((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
    }
  }

  async function handleConfirmRemove() {
    if (!memberToRemove) return;
    setRemoving(true);
    try {
      const res = await revokeMemberAction(tenantId, memberToRemove.metadata.name);
      if (!res.ok) throw new Error(res.error);
      toast.success(`${memberToRemove.spec.email} has been removed.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove user."
      );
    } finally {
      setRemoving(false);
      setMemberToRemove(null);
    }
  }

  async function handleResend(member: TenantMember) {
    try {
      const res = await resendInvitationAction(tenantId, member.metadata.name);
      if (!res.ok) throw new Error(res.error);
      toast.success(`Invitation resent to ${member.spec.email}.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resend invitation."
      );
    }
  }

  async function handleConfirmCancel() {
    if (!memberToCancel) return;
    setCancelling(true);
    try {
      const res = await revokeMemberAction(tenantId, memberToCancel.metadata.name);
      if (!res.ok) throw new Error(res.error);
      toast.success(`Invitation for ${memberToCancel.spec.email} has been cancelled.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to cancel invitation."
      );
    } finally {
      setCancelling(false);
      setMemberToCancel(null);
    }
  }

  const isLoading = status === "connecting" || status === "idle";
  const isError = status === "error";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight font-mono text-glow-green lg:text-2xl">
            User Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage users and roles for your workspace.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite User
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          placeholder="Search by email..."
          className="pl-9 font-mono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Error state */}
      {isError && error && (
        <ErrorAlert
          error={new Error(error)}
          title="Failed to load users"
        />
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton rows={5} cols={5} />}

      {/* Empty state — no users at all (not just filtered) */}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={UserPlus}
          title="No users yet"
          description="Invite teammates so they can sign in to this workspace. Roles control what each user can manage."
          primaryCta={
            canEdit ? (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-4" />
                Invite your first user
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Table */}
      {!isLoading && !isError && items.length > 0 && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead className="w-40">Role</TableHead>
                <TableHead>Teams</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28">Invited</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => {
                const isSelf = member.status?.userId === currentUserId;
                const userId = member.status?.userId ?? member.metadata.name;
                const specRole = member.spec.role;
                const isOwner = specRole === "owner";
                const effectiveRole = roleOverrides[userId] ?? specRole ?? "member";
                const phase = member.status?.phase ?? "Pending";
                const userTeams = teamsByUser[userId] ?? [];
                const showDropdown = canEdit && !isSelf && !isOwner;
                const isPending = !!pendingRole[userId];
                return (
                  <TableRow key={member.metadata.name}>
                    <TableCell className="font-medium">
                      <span className="data-value text-xs">{member.spec.email}</span>
                    </TableCell>
                    <TableCell>
                      {showDropdown ? (
                        <Select
                          value={effectiveRole}
                          onValueChange={(v) =>
                            handleRoleChange(member, v as "admin" | "member")
                          }
                          disabled={isPending}
                        >
                          <SelectTrigger size="sm" className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">admin</SelectItem>
                            <SelectItem value="member">member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant="outline"
                          className={`text-xs font-mono ${ROLE_BADGE_CLASS[effectiveRole] ?? ROLE_BADGE_CLASS.viewer}`}
                        >
                          {effectiveRole}{isSelf ? " (you)" : ""}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {teamsLoading ? (
                        <span className="text-xs text-muted-foreground">Loading…</span>
                      ) : (
                        <TeamMembershipChips teams={userTeams} />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs font-mono text-muted-foreground">
                          {phase}
                        </span>
                        {phase === "Invited" && member.status?.invitationExpiresAt && (() => {
                          const expiresAt = new Date(member.status!.invitationExpiresAt!);
                          const isExpired = expiresAt < new Date();
                          return (
                            <span className="text-xs text-muted-foreground">
                              {isExpired
                                ? "Expired"
                                : `expires in ${formatDistanceToNow(expiresAt)}`}
                            </span>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {member.metadata.creationTimestamp
                        ? new Date(member.metadata.creationTimestamp).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <UserActionsMenu
                        member={member}
                        canEdit={canEdit}
                        isSelf={isSelf}
                        isOwner={isOwner}
                        onRemove={setMemberToRemove}
                        onResend={handleResend}
                        onCancel={setMemberToCancel}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {search ? "No users matching your search." : "No users found."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Invite dialog */}
      {tenantId && (
        <InviteUserDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          tenantId={tenantId}
        />
      )}

      {/* Remove confirmation dialog */}
      <AlertDialog
        open={!!memberToRemove}
        onOpenChange={(open) => { if (!open) setMemberToRemove(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <strong>{memberToRemove?.spec.email}</strong> from this workspace.
              They will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              disabled={removing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removing ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel invitation confirmation dialog */}
      <AlertDialog
        open={!!memberToCancel}
        onOpenChange={(open) => { if (!open) setMemberToCancel(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancel invitation for{" "}
              <strong>{memberToCancel?.spec.email}</strong>? They will not be
              able to use the invitation link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>
              Keep invitation
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              disabled={cancelling}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancelling ? "Cancelling..." : "Cancel invitation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
