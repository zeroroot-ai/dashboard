"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "@/src/lib/session-client";
import { usePermitted } from "@/src/lib/auth/tenant";
import { MoreHorizontal, Search, Trash2, UserPlus, Eye } from "lucide-react";
import { toast } from "sonner";

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
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { InviteUserDialog } from "./InviteUserDialog";
import { useCRDWatch } from "@/src/hooks/useCRDWatch";
import { revokeMemberAction } from "@/app/actions/crd/member";
import type { TenantMember } from "@/src/lib/k8s/types";

// ── Styles ────────────────────────────────────────────────────────────────────

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: "border-primary/50 bg-primary/10 text-primary",
  member: "border-blue-500/50 bg-blue-950/20 text-blue-400",
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
  onRemove,
}: {
  member: TenantMember;
  canEdit: boolean;
  isSelf: boolean;
  onRemove: (member: TenantMember) => void;
}) {
  const userId = member.status?.userId ?? member.metadata.name;
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
          <Link href={`/dashboard/users/${userId}`}>
            <Eye className="size-4" />
            View Details
          </Link>
        </DropdownMenuItem>
        {canEdit && !isSelf && (
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = session as any;
  const tenantId = s?.user?.tenantId ?? "";
  const currentUserId = s?.user?.id ?? "";
  const canEdit = usePermitted("team:manage");

  const namespace = tenantId ? tenantNamespace(tenantId) : undefined;

  const { items, status, error } = useCRDWatch("TenantMember", namespace, {
    enabled: !!tenantId,
  });

  const [search, setSearch] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<TenantMember | null>(null);
  const [removing, setRemoving] = React.useState(false);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((m) =>
      m.spec.email.toLowerCase().includes(q)
    );
  }, [items, search]);

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

      {/* Table */}
      {!isLoading && !isError && (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((member) => {
                const isSelf = member.status?.userId === currentUserId;
                const role = member.spec.role;
                const phase = member.status?.phase ?? "Pending";
                return (
                  <TableRow key={member.metadata.name}>
                    <TableCell className="font-medium">
                      <span className="data-value text-xs">{member.spec.email}</span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs font-mono ${ROLE_BADGE_CLASS[role] ?? ROLE_BADGE_CLASS.viewer}`}
                      >
                        {role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-muted-foreground">
                        {phase}
                      </span>
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
                        onRemove={setMemberToRemove}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
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
    </div>
  );
}
