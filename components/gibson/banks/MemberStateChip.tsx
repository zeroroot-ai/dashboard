"use client";

/**
 * The member state chip, in the words the docs use: idle, busy N/cap,
 * needs sign-in, draining, dead (gibson#1706). Shared by the bank page and
 * the console tiles.
 */

import { Badge } from "@/components/ui/badge";
import { memberStateLabel, type MemberStateName, type MemberView } from "@/src/lib/banks/view";
import { cn } from "@/lib/utils";

const STATE_CLASS: Record<MemberStateName, string> = {
  idle: "border-primary/50 bg-primary/10 text-primary",
  busy: "border-alt/50 bg-alt/10 text-alt",
  needs_sign_in: "border-destructive/50 bg-destructive/10 text-destructive",
  draining: "border-border text-muted-foreground",
  dead: "border-destructive/50 text-destructive",
  launching: "border-border text-muted-foreground",
  unknown: "border-border text-muted-foreground",
};

export function MemberStateChip({
  member,
  className,
}: {
  member: Pick<MemberView, "state" | "jobsInFlight" | "cap">;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[0.65rem]", STATE_CLASS[member.state], className)}
      data-testid="member-state"
      data-state={member.state}
    >
      {memberStateLabel(member)}
    </Badge>
  );
}
