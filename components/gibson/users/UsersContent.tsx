"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/src/lib/session-client";
import { useTenantId } from "@/src/lib/auth/tenant";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { MoreHorizontal, Search, Trash2, UserPlus, Eye, Mail, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useOrgGraph } from "@/src/hooks/use-org-graph";
import { revokeMemberAction, resendInvitationAction } from "@/app/actions/crd/member";
import { setTenantRoleAction } from "@/app/actions/crd/role";
import { listMembersAction, type MemberRow } from "@/app/actions/read/listMembers";

// ── Styles ────────────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner: "border-alt/50 bg-alt/10 text-alt",
  admin: "border-primary/50 bg-primary/10 text-primary",
  member: "border-link/50 bg-link/10/20 text-link",
  viewer: "border-border bg-muted/50 text-muted-foreground",
};

/** A row key that is stable for both active members (userId) and pending
 * invitations (email, where userId is empty). */
function rowKey(m: MemberRow): string {
  return m.userId || `invite:${m.email}`;
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
  member: MemberRow;
  canEdit: boolean;
  isSelf: boolean;
  isOwner: boolean;
  onRemove: (member: MemberRow) => void;
  onResend: (member: MemberRow) => void;
  onCancel: (member: MemberRow) => void;
}) {
  const isInvited = member.status === "invited";
  const canRemove = canEdit && !isSelf && !isOwner;

  // For owner rows there are no destructive actions — wrap the trigger with a
  // tooltip so admins know why the row is protected.
  const ownerNoActions = isOwner && !isSelf;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
          <span className="sr-only">Open actions for {member.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {member.userId && (
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/organization/users/${member.userId}`}>
              <Eye className="size-4" />
              View Details
            </Link>
          </DropdownMenuItem>
        )}
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

  if (ownerNoActions) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>{menu}</span>
          </TooltipTrigger>
          <TooltipContent side="left">
            Owner — transfer ownership before making changes
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return menu;
}

// ── Main component ────────────────────────────────────────────────────────────

export function UsersContent() {
  const { data: session } = useSession();
  const tenantId = useTenantId() ?? "";
  const currentUserId = session?.user?.id ?? "";
  // Member/role management is gated on the role-assignment RPC (relation: admin).
  // Destructure `loading` to satisfy the hide-on-loading contract (see CLAUDE.md
  // "Frontend authz"). Until resolved, treat as not allowed.
  const { allowed: canEditResolved, loading: authLoading } = useAuthorize(
    "/gibson.tenant.v1.MembershipService/SetTenantRole",
  );
  const canEdit = !authLoading && canEditResolved;

  // Roster from the daemon (MembershipService.ListMembers) — the single source
  // of truth post dashboard#715. Active members + pending invitations both
  // arrive here; status discriminates them. Refetched after every mutation.
  const {
    data: membersResult,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: () => listMembersAction(),
    enabled: !!tenantId,
  });
  const items: MemberRow[] = membersResult?.ok ? membersResult.data : [];
  const loadError = membersResult && !membersResult.ok ? membersResult.error : null;

  const { data: orgGraph, loading: teamsLoading } = useOrgGraph();
  const teamsByUser = orgGraph.byUser;

  const [search, setSearch] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<MemberRow | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [memberToCancel, setMemberToCancel] = React.useState<MemberRow | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [pendingRole, setPendingRole] = React.useState<Record<string, boolean>>({});

  const filtered = React.useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((m) => m.email.toLowerCase().includes(q));
  }, [items, search]);

  async function handleRoleChange(member: MemberRow, role: "admin" | "member") {
    const key = rowKey(member);
    setPendingRole((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await setTenantRoleAction({ userId: member.userId, role });
      if (!res.ok) throw new Error(res.error ?? "failed");
      toast.success(`${member.email} is now ${role}.`);
      await refetch();
    } catch (err) {
      toast.error(
        `Failed to change role: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setPendingRole((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  async function handleConfirmRemove() {
    if (!memberToRemove) return;
    setRemoving(true);
    try {
      const res = await revokeMemberAction({
        userId: memberToRemove.userId,
        email: memberToRemove.email,
        status: memberToRemove.status,
      });
      if (!res.ok) throw new Error(res.error);
      toast.success(`${memberToRemove.email} has been removed.`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove user.");
    } finally {
      setRemoving(false);
      setMemberToRemove(null);
    }
  }

  async function handleResend(member: MemberRow) {
    try {
      const res = await resendInvitationAction({ email: member.email });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Invitation resent to ${member.email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend invitation.");
    }
  }

  async function handleConfirmCancel() {
    if (!memberToCancel) return;
    setCancelling(true);
    try {
      const res = await revokeMemberAction({
        userId: "",
        email: memberToCancel.email,
        status: "invited",
      });
      if (!res.ok) throw new Error(res.error);
      toast.success(`Invitation for ${memberToCancel.email} has been cancelled.`);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel invitation.");
    } finally {
      setCancelling(false);
      setMemberToCancel(null);
    }
  }

  const isError = !!loadError;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight font-mono text-glow-green lg:text-2xl">
            Members
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage members and roles for your workspace.
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
      {isError && loadError && (
        <ErrorAlert error={new Error(loadError)} title="Failed to load members" />
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton rows={5} cols={5} />}

      {/* Empty state — no users at all (not just filtered) */}
      {!isLoading && !isError && items.length === 0 && (
        <EmptyState
          icon={UserPlus}
          title="No members yet"
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
                <TableHead className="w-28">Joined</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => {
                const key = rowKey(member);
                const isSelf = !!member.userId && member.userId === currentUserId;
                const role = member.role || "member";
                const isOwner = role === "owner";
                const isInvited = member.status === "invited";
                const userTeams = member.userId ? teamsByUser[member.userId] ?? [] : [];
                const showDropdown = canEdit && !isSelf && !isOwner && !isInvited;
                const isPending = !!pendingRole[key];
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">
                      <span className="data-value text-xs">{member.email}</span>
                    </TableCell>
                    <TableCell>
                      {showDropdown ? (
                        <Select
                          value={role}
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
                          className={`text-xs font-mono ${ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.viewer}`}
                        >
                          {role}{isSelf ? " (you)" : ""}
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
                      <span className="text-xs font-mono text-muted-foreground">
                        {isInvited ? "Invited" : "Active"}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {member.joinedAt
                        ? new Date(member.joinedAt).toLocaleDateString()
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
          onInvited={() => refetch()}
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
              <strong>{memberToRemove?.email}</strong> from this workspace.
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
              <strong>{memberToCancel?.email}</strong>? They will not be
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
