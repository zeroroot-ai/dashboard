"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/src/lib/session-client";
import { useTenantId } from "@/src/lib/auth/tenant";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { useTenantContext } from "@/src/lib/tenant-context";
import { ArrowLeft, ArrowRightLeft, LogOut, Mail, ShieldOff } from "lucide-react";
import { toast } from "sonner";

import { UserTeamMembershipsEditor } from "@/components/gibson/users/UserTeamMembershipsEditor";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { transferOwnershipAction } from "@/app/actions/crd/transfer-ownership";
import { revokeMemberAction, resendInvitationAction } from "@/app/actions/crd/member";
import { setTenantRoleAction } from "@/app/actions/crd/role";
import { revokeUserSessionsAction } from "@/app/actions/crd/sessions";
import { listMembersAction, type MemberRow } from "@/app/actions/read/listMembers";
import type { TenantRole } from "@/app/actions/crd/role";
import type { MemberRole } from "@/app/actions/crd/types";

const ROLE_BADGE_CLASS: Record<string, string> = {
  owner: "border-alt/50 bg-alt/10 text-alt",
  admin: "border-primary/50 bg-primary/10 text-primary",
  member: "border-link/50 bg-link/10/20 text-link",
  viewer: "border-border bg-muted/50 text-muted-foreground",
};

function getInitials(name?: string | null): string {
  if (!name) return "??";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}


export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;

  const { data: session } = useSession();
  const tenantId = useTenantId() ?? "";
  const { rolesByTenant } = useTenantContext();
  const currentUserId = session?.user?.id ?? "";
  const isSelf = userId === currentUserId;
  // Member/role management is gated on the role-assignment RPC (relation: admin).
  const { allowed: canManageMembers, loading: authLoading } = useAuthorize(
    "/gibson.tenant.v1.MembershipService/SetTenantRole",
  );
  // During the auth query, treat as not allowed (hide-on-loading contract).
  const canEdit = !authLoading && canManageMembers && !isSelf;

  // Derive whether the viewing user is the tenant owner from the FGA-resolved
  // rolesByTenant map populated by TenantContextProvider.
  const viewerRole = tenantId ? (rolesByTenant[tenantId] ?? "") : "";
  const viewerIsOwner = viewerRole === "owner";

  // Member detail from the daemon roster (MembershipService.ListMembers), the
  // single source of truth post dashboard#715. The page keys on userId; pending
  // invitations (no userId) are matched by email fallback.
  const { data: membersResult, isLoading, refetch } = useQuery({
    queryKey: ["tenant-members", tenantId],
    queryFn: () => listMembersAction(),
    enabled: !!tenantId,
  });
  const members: MemberRow[] = membersResult?.ok ? membersResult.data : [];

  const member = React.useMemo(
    () => members.find((m) => m.userId === userId || m.email === userId),
    [members, userId],
  );

  const isActive = member?.status === "active";
  const isInvited = member?.status === "invited";
  const isOwner = member?.role === "owner";

  // Transfer ownership dialog state.
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferring, setTransferring] = React.useState(false);

  // Revoke access dialog state.
  const [revokeOpen, setRevokeOpen] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [revokingSessions, setRevokingSessions] = React.useState(false);

  // Role change state. The override is a TenantRole because setTenantRoleAction
  // only accepts admin|member, owners cannot be set via this dropdown.
  const [roleOverride, setRoleOverride] = React.useState<TenantRole | null>(null);
  const [changingRole, setChangingRole] = React.useState(false);

  // Displayed role: local override after a successful change, else the
  // daemon-reported role.
  const effectiveRole: MemberRole | undefined =
    roleOverride ?? (member?.role as MemberRole | undefined);

  const targetIsActiveAdmin =
    member?.role === "admin" && isActive;
  const showTransferOwnership =
    canEdit && viewerIsOwner && targetIsActiveAdmin;
  const showRevokeAccess =
    canEdit && isActive && !isOwner;
  // Revoke sessions: admins may force-logout any active member; a member may
  // always sign themselves out everywhere. The daemon enforces the
  // can_revoke_sessions decision (gibson#622); this only controls visibility.
  const showRevokeSessions = isActive && (canEdit || isSelf);
  const showResendInvitation = canEdit && isInvited;
  const showRoleDropdown =
    canEdit && isActive && !isOwner;

  async function handleTransferOwnership() {
    setTransferring(true);
    try {
      const targetUserId = member?.userId;
      if (!targetUserId) {
        toast.error("Cannot determine target user ID.");
        return;
      }
      const result = await transferOwnershipAction(targetUserId);
      if (result.ok) {
        toast.success(
          `Ownership transferred to ${member?.email ?? targetUserId}.`,
        );
        router.push("/dashboard/organization/users");
      } else {
        toast.error(result.error || "Transfer failed.");
      }
    } finally {
      setTransferring(false);
      setTransferOpen(false);
    }
  }

  async function handleRevokeAccess() {
    if (!member) return;
    setRevoking(true);
    try {
      const result = await revokeMemberAction({
        userId: member.userId,
        email: member.email,
        status: member.status,
      });
      if (result.ok) {
        toast.success(`${member.email} has been removed from the workspace.`);
        router.push("/dashboard/organization/users");
      } else {
        toast.error(result.error || "Failed to revoke access.");
      }
    } finally {
      setRevoking(false);
      setRevokeOpen(false);
    }
  }

  async function handleRevokeSessions() {
    if (!member) return;
    const targetUserId = member.userId;
    setRevokingSessions(true);
    try {
      const result = await revokeUserSessionsAction({ targetUserId });
      if (result.ok) {
        toast.success(
          isSelf
            ? "You've been signed out of all sessions."
            : `Revoked sessions for ${member.email ?? targetUserId}.`,
        );
      } else {
        toast.error(result.error || "Failed to revoke sessions.");
      }
    } finally {
      setRevokingSessions(false);
    }
  }

  async function handleResendInvitation() {
    if (!member) return;
    try {
      const result = await resendInvitationAction({ email: member.email });
      if (result.ok) {
        toast.success(`Invitation resent to ${member.email}.`);
      } else {
        toast.error(result.error || "Failed to resend invitation.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resend invitation.",
      );
    }
  }

  async function handleRoleChange(role: TenantRole) {
    if (!member) return;
    const targetUserId = member.userId;
    setChangingRole(true);
    try {
      const result = await setTenantRoleAction({ userId: targetUserId, role });
      if (result.ok) {
        setRoleOverride(role);
        toast.success(`${member.email} is now ${role}.`);
        await refetch();
      } else {
        toast.error(result.error || "Failed to change role.");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to change role.",
      );
    } finally {
      setChangingRole(false);
    }
  }

  const hasAnyAction =
    showRoleDropdown ||
    showResendInvitation ||
    showTransferOwnership ||
    showRevokeAccess ||
    showRevokeSessions;

  return (
    <div className="space-y-4">
      {/* Back navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="gap-1.5 text-muted-foreground"
        >
          <Link href="/dashboard/organization/users">
            <ArrowLeft className="size-3.5" />
            Users
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-xl font-bold tracking-tight font-mono text-glow-green lg:text-2xl">
          User Details
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          <span className="data-value text-xs">{userId}</span>
        </p>
      </div>

      <Separator className="bg-highlight/20" />

      {/* Loading */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="glass-hack border-0">
              <CardContent className="space-y-4 pt-6">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Not found */}
      {!isLoading && !member && (
        <Card className="glass-hack border-0">
          <CardContent className="py-12 text-center text-muted-foreground">
            User not found.{" "}
            <Link
              href="/dashboard/organization/users"
              className="text-primary hover:underline"
            >
              Back to members
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {!isLoading && member && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {/* Profile card */}
            <Card className="glass-hack border-0">
              <CardHeader>
                <CardTitle className="font-mono text-base">Profile</CardTitle>
                <CardDescription>User account information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="text-lg">
                      {getInitials(member.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-medium">
                      {member.email.split("@")[0]}
                    </p>
                    <p className="data-value text-sm text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                </div>

                <Separator className="bg-highlight/20" />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Role
                    </p>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${ROLE_BADGE_CLASS[effectiveRole ?? "viewer"] ?? ROLE_BADGE_CLASS.viewer}`}
                    >
                      {effectiveRole ?? member.role}
                      {isSelf && " (you)"}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Status
                    </p>
                    <p className="text-sm font-mono">{isInvited ? "Invited" : "Active"}</p>
                  </div>
                  <div className="space-y-1.5">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Member since
                    </p>
                    <p className="text-sm tabular-nums">
                      {member.joinedAt
                        ? new Date(member.joinedAt).toLocaleDateString()
                        : "-"}
                    </p>
                  </div>
                </div>

                <Separator className="bg-highlight/20" />

                {/* Collapsible user ID, useful for support without cluttering primary UI */}
                <details className="group">
                  <summary className="cursor-pointer list-none">
                    <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider select-none">
                      User ID{" "}
                      <span className="group-open:hidden">▸</span>
                      <span className="hidden group-open:inline">▾</span>
                    </span>
                  </summary>
                  <p className="data-value mt-2 text-xs break-all">
                    {member.userId}
                  </p>
                </details>
              </CardContent>
            </Card>

            {/* Actions card, only rendered when at least one action is available */}
            {hasAnyAction && (
              <Card className="glass-hack border-0">
                <CardHeader>
                  <CardTitle className="font-mono text-base">Actions</CardTitle>
                  <CardDescription>
                    Manage this user&apos;s role and workspace access.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {showRoleDropdown && (
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="font-mono text-sm">Change role</p>
                        <p className="text-xs text-muted-foreground">
                          Promote or demote this user within the workspace.
                        </p>
                      </div>
                      <Select
                        value={(effectiveRole === "admin" || effectiveRole === "member") ? effectiveRole : "member"}
                        onValueChange={(v) => handleRoleChange(v as TenantRole)}
                        disabled={changingRole}
                      >
                        <SelectTrigger size="sm" className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">admin</SelectItem>
                          <SelectItem value="member">member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {showResendInvitation && (
                    <>
                      {showRoleDropdown && <Separator className="bg-highlight/20" />}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="font-mono text-sm">Resend invitation</p>
                          <p className="text-xs text-muted-foreground">
                            Send a new invitation email to {member.email}.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          onClick={handleResendInvitation}
                        >
                          <Mail className="size-3.5" />
                          Resend
                        </Button>
                      </div>
                    </>
                  )}

                  {showTransferOwnership && (
                    <>
                      {(showRoleDropdown || showResendInvitation) && (
                        <Separator className="bg-highlight/20" />
                      )}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="font-mono text-sm">Transfer ownership</p>
                          <p className="text-xs text-muted-foreground">
                            Make {member.email} the workspace owner. You
                            will become an admin.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                          onClick={() => setTransferOpen(true)}
                        >
                          <ArrowRightLeft className="size-3.5" />
                          Transfer
                        </Button>
                      </div>
                    </>
                  )}

                  {showRevokeSessions && (
                    <>
                      {(showRoleDropdown ||
                        showResendInvitation ||
                        showTransferOwnership) && (
                        <Separator className="bg-highlight/20" />
                      )}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="font-mono text-sm">
                            {isSelf ? "Sign out everywhere" : "Revoke sessions"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {isSelf
                              ? "End all of your active sessions and refresh tokens. You'll need to sign in again."
                              : `End all active sessions and refresh tokens for ${member.email}. New tokens are blocked immediately; any current token expires within 15 minutes.`}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                          disabled={revokingSessions}
                          onClick={handleRevokeSessions}
                        >
                          <LogOut className="size-3.5" />
                          {revokingSessions
                            ? "Revoking…"
                            : isSelf
                              ? "Sign out everywhere"
                              : "Revoke sessions"}
                        </Button>
                      </div>
                    </>
                  )}

                  {showRevokeAccess && (
                    <>
                      {(showRoleDropdown ||
                        showResendInvitation ||
                        showTransferOwnership ||
                        showRevokeSessions) && (
                        <Separator className="bg-highlight/20" />
                      )}
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="font-mono text-sm">Revoke access</p>
                          <p className="text-xs text-muted-foreground">
                            Remove {member.email} from this workspace
                            immediately.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                          onClick={() => setRevokeOpen(true)}
                        >
                          <ShieldOff className="size-3.5" />
                          Revoke
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          <div>
            <UserTeamMembershipsEditor userId={userId} canEdit={canEdit} />
          </div>
        </div>
      )}

      {/* Transfer Ownership confirmation dialog */}
      <AlertDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Transfer ownership to {member?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You will become an admin. This cannot be undone without another
              transfer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transferring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTransferOwnership}
              disabled={transferring}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {transferring ? "Transferring..." : "Transfer Ownership"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke Access confirmation dialog */}
      <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {member?.email} from the workspace?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access immediately. This cannot be undone, you
              will need to re-invite them to restore access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeAccess}
              disabled={revoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revoking ? "Removing..." : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
