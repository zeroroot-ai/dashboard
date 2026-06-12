"use client";

/**
 * Chips representing a user's team memberships. Up to three chips render
 * inline; the remainder collapses to a "+N more" chip. Each chip is a
 * link to the team detail page. dashboard#150 (S6).
 */

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { UserTeamMembership } from "@/src/hooks/use-org-graph";

const MAX_VISIBLE = 3;

export function TeamMembershipChips({
  teams,
}: {
  teams: UserTeamMembership[];
}) {
  if (teams.length === 0) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }
  const visible = teams.slice(0, MAX_VISIBLE);
  const overflow = teams.length - visible.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((t) => (
        <Badge
          key={t.teamId}
          asChild
          variant="outline"
          className="cursor-pointer text-xs font-mono hover:bg-accent"
        >
          <Link
            href={`/dashboard/organization/teams/${encodeURIComponent(t.teamId)}`}
          >
            {t.displayName}
          </Link>
        </Badge>
      ))}
      {overflow > 0 ? (
        <Badge
          variant="outline"
          className="text-xs font-mono text-muted-foreground"
          title={teams
            .slice(MAX_VISIBLE)
            .map((t) => t.displayName)
            .join(", ")}
        >
          +{overflow} more
        </Badge>
      ) : null}
    </div>
  );
}
