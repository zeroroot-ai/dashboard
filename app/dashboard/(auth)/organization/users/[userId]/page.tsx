"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/src/lib/session-client";
import { usePermitted, useTenantId } from "@/src/lib/auth/tenant";
import { useTenantContext } from "@/src/lib/tenant-context";
import { ArrowLeft, Shield, ArrowRightLeft } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useCRDWatch } from "@/src/hooks/useCRDWatch";
import { transferOwnershipAction } from "@/app/actions/crd/transfer-ownership";

const ROLE_BADGE_CLASS: Record<string, string> = {
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

function tenantNamespace(name: string): string {
  return `tenant-${name}`;
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
  const canEdit = usePermitted("team:manage") && !isSelf;

  // Derive whether the viewing user is the tenant owner from the FGA-resolved
  // rolesByTenant map. This is populated server-side via getMyMemberships() +
  // the active-tenant cookie and passed through TenantContextProvider.
  const viewerRole = tenantId ? (rolesByTenant[tenantId] ?? "") : "";
  const viewerIsOwner = viewerRole === "owner";

  const namespace = tenantId ? tenantNamespace(tenantId) : undefined;
  const { items, status } = useCRDWatch("TenantMember", namespace, {
    enabled: !!tenantId,
  });

  const member = React.useMemo(
    () =>
      items.find(
        (m) => m.status?.userId === userId || m.metadata.name === userId,
      ),
    [items, userId],
  );

  const isLoading = status === "connecting" || status === "idle";

  // Transfer ownership dialog state.
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferring, setTransferring] = React.useState(false);

  // Conditions for showing "Transfer Ownership":
  //   1. canEdit is true (viewer has team:manage permission AND is not viewing self)
  //   2. viewer is the owner
  //   3. target is an Active admin
  //   4. target is not the current user (already covered by canEdit)
  const targetIsActiveAdmin =
    member?.spec.role === "admin" && member?.status?.phase === "Active";
  const showTransferOwnership = canEdit && viewerIsOwner && targetIsActiveAdmin;

  async function handleTransferOwnership() {
    setTransferring(true);
    try {
      const targetUserId = member?.status?.userId;
      if (!targetUserId) {
        toast.error("Cannot determine target user ID.");
        return;
      }
      const result = await transferOwnershipAction(targetUserId);
      if (result.ok) {
        toast.success(`Ownership transferred to ${member?.spec.email ?? targetUserId}.`);
        router.push("/dashboard/organization/users");
      } else {
        toast.error(result.error || "Transfer failed.");
      }
    } finally {
      setTransferring(false);
      setTransferOpen(false);
    }
  }

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
            <Link href="/dashboard/organization/users" className="text-primary hover:underline">
              Back to users
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Content */}
      {!isLoading && member && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card className="glass-hack border-0">
              <CardHeader>
                <CardTitle className="font-mono text-base">Profile</CardTitle>
                <CardDescription>User account information</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16">
                    <AvatarFallback className="text-lg">
                      {getInitials(member.spec.email)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-lg font-medium">
                      {member.spec.email.split("@")[0]}
                    </p>
                    <p className="data-value text-sm text-muted-foreground">
                      {member.spec.email}
                    </p>
                  </div>
                </div>

                <Separator className="bg-highlight/20" />

                <div className="space-y-2">
                  <label className="font-mono text-sm text-muted-foreground">
                    Role
                  </label>
                  <Badge
                    variant="outline"
                    className={`text-xs font-mono ${ROLE_BADGE_CLASS[member.spec.role] ?? ROLE_BADGE_CLASS.viewer}`}
                  >
                    {member.spec.role}
                    {isSelf && " (you)"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Status
                    </p>
                    <p className="text-sm">
                      {member.status?.phase ?? "Pending"}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
                      Invited
                    </p>
                    <p className="text-sm tabular-nums">
                      {member.metadata.creationTimestamp
                        ? new Date(member.metadata.creationTimestamp).toLocaleDateString()
                        : "—"}
                    </p>
                  </div>
                </div>

                {/* Transfer Ownership entry point */}
                {showTransferOwnership && (
                  <>
                    <Separator className="bg-highlight/20" />
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="font-mono text-sm">Transfer Ownership</p>
                        <p className="text-xs text-muted-foreground">
                          Make {member.spec.email} the workspace owner. You will become an admin.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-destructive/50 text-destructive hover:bg-destructive/10"
                        onClick={() => setTransferOpen(true)}
                      >
                        <ArrowRightLeft className="size-3.5" />
                        Transfer Ownership
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <UserTeamMembershipsEditor userId={userId} canEdit={canEdit} />

            <Card className="glass-hack border-0">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-highlight" aria-hidden="true" />
                  <CardTitle className="font-mono text-base">
                    Account Management
                  </CardTitle>
                </div>
                <CardDescription>
                  Session management, password, and MFA are handled by your identity provider.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  To view or revoke active sessions and manage account security, visit your identity provider&apos;s profile page.
                </p>
                <a
                  href={
                    (process.env.NEXT_PUBLIC_IDENTITY_PROVIDER_URL
                      ? `${process.env.NEXT_PUBLIC_IDENTITY_PROVIDER_URL}/ui/console`
                      : '#')
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  Manage account at provider
                </a>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Transfer Ownership confirmation dialog */}
      <AlertDialog open={transferOpen} onOpenChange={setTransferOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Transfer ownership to {member?.spec.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will become an admin. This cannot be undone without another transfer.
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
    </div>
  );
}
