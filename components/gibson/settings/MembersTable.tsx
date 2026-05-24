"use client";

/**
 * MembersTable — renders the list of tenant members returned by
 * listMembersAction as a shadcn Table.
 *
 * Columns: Avatar (initials) | Name | Email | Role badge | Joined date
 *
 * No actions column in v1 — invite/remove is deferred per dashboard#340.
 *
 * Spec: dashboard#340 Module E.
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MemberRow } from "@/app/actions/read/listMembers";

function initials(displayName: string, email: string): string {
  if (displayName) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDate(isoString: string): string {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function RoleBadge({ role }: { role: string }) {
  const normalised = role.toLowerCase();
  if (normalised === "admin") {
    return (
      <Badge variant="default" className="bg-primary/20 text-primary border-primary/30 hover:bg-primary/20">
        admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      {normalised || "member"}
    </Badge>
  );
}

export interface MembersTableProps {
  members: MemberRow[];
}

export function MembersTable({ members }: MembersTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10" />
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Joined</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.userId}>
            <TableCell>
              <Avatar className="size-8">
                <AvatarFallback className="text-xs">
                  {initials(m.displayName, m.email)}
                </AvatarFallback>
              </Avatar>
            </TableCell>
            <TableCell className="font-medium">
              {m.displayName || <span className="text-muted-foreground italic">unnamed</span>}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {m.email}
            </TableCell>
            <TableCell>
              <RoleBadge role={m.role} />
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(m.joinedAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
