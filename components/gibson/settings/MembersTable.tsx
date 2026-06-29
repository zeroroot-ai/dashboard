"use client";

/**
 * MembersTable, renders the list of tenant members returned by
 * listMembersAction as a shadcn Table.
 *
 * Columns: Avatar (initials) | Name | Email | Role badge | Joined date
 *
 * No actions column in v1, invite/remove is deferred per dashboard#340.
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
  if (!isoString) return "-";
  try {
    return new Date(isoString).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "-";
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

interface MembersTableProps {
  members: MemberRow[];
  /**
   * The signed-in user's identity. Used to fall back to the session's own
   * name/email for the caller's row when directory enrichment returned blank,
   * so the page is never empty for the person looking at it.
   */
  currentUser?: { id: string; name: string; email: string };
}

/**
 * Resolve the name/email to display for a member row. For the caller's own
 * row, fall back to the session identity when the directory lookup returned
 * blank. `enriched` is false when neither a name nor an email is known, the
 * row renders a "profile unavailable" state rather than an empty cell.
 */
function resolveIdentity(
  m: MemberRow,
  currentUser?: MembersTableProps["currentUser"],
): { name: string; email: string; enriched: boolean } {
  const isSelf = !!currentUser && m.userId === currentUser.id;
  const name = m.displayName || (isSelf ? currentUser!.name : "");
  const email = m.email || (isSelf ? currentUser!.email : "");
  return { name, email, enriched: Boolean(name || email) };
}

export function MembersTable({ members, currentUser }: MembersTableProps) {
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
        {members.map((m) => {
          const { name, email, enriched } = resolveIdentity(m, currentUser);
          return (
            <TableRow key={m.userId}>
              <TableCell>
                <Avatar className="size-8">
                  <AvatarFallback className="text-xs">
                    {enriched ? initials(name, email) : "?"}
                  </AvatarFallback>
                </Avatar>
              </TableCell>
              <TableCell className="font-medium">
                {name ? (
                  name
                ) : enriched ? (
                  <span className="text-muted-foreground italic">unnamed</span>
                ) : (
                  <span className="text-muted-foreground italic">
                    Profile unavailable
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {email ? (
                  email
                ) : (
                  // No email known, surface the stable user id so the row is
                  // still identifiable rather than blank.
                  <span className="font-mono text-xs">{m.userId}</span>
                )}
              </TableCell>
              <TableCell>
                <RoleBadge role={m.role} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDate(m.joinedAt)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
