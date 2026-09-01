"use client";

/**
 * The members of one bank (gibson#1706 lane E1): state chip in the words the
 * docs use (idle, busy N/cap, needs sign-in, draining, dead), last heartbeat,
 * Claude Code version, open jobs, and a link to the member's console pane.
 */

import * as React from "react";
import Link from "next/link";
import { TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { consoleHref } from "@/components/gibson/agent-console/useLiveRun";
import { formatDuration, shortId } from "@/src/lib/agent-console/stream-json";
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

function MemberStateChip({ member }: { member: Pick<MemberView, "state" | "jobsInFlight" | "cap"> }) {
  return (
    <Badge
      variant="outline"
      className={cn("font-mono text-[0.65rem]", STATE_CLASS[member.state])}
      data-testid="member-state"
      data-state={member.state}
    >
      {memberStateLabel(member)}
    </Badge>
  );
}

function heartbeatLabel(iso: string | null, now: number): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "unknown";
  return `${formatDuration(Math.max(0, now - t))} ago`;
}

interface MemberListProps {
  members: readonly MemberView[];
  /** Extra cell per row, for the sign-in action (dashboard#1169). */
  renderAction?: (member: MemberView) => React.ReactNode;
}

export function MemberList({ members, renderAction }: MemberListProps) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="members-empty">
        No members yet. The daemon launches them until the desired count runs.
      </p>
    );
  }

  return (
    <Table data-testid="member-list">
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>State</TableHead>
          <TableHead>Open jobs</TableHead>
          <TableHead>Last heartbeat</TableHead>
          <TableHead>Claude Code</TableHead>
          <TableHead className="text-right">Console</TableHead>
          {renderAction ? <TableHead className="text-right">Sign-in</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => (
          <TableRow key={m.id} data-testid="member-row" data-member-id={m.id}>
            <TableCell className="font-mono text-xs" title={m.id}>{shortId(m.id)}</TableCell>
            <TableCell><MemberStateChip member={m} /></TableCell>
            <TableCell className="font-mono text-xs tabular-nums" data-testid="member-open-jobs">{m.activeJobIds.length}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{heartbeatLabel(m.lastHeartbeat, now)}</TableCell>
            <TableCell className="font-mono text-xs">{m.claudeVersion || "unknown"}</TableCell>
            <TableCell className="text-right">
              {m.agentRunId ? (
                <Link
                  href={consoleHref(m.agentRunId)}
                  className="inline-flex items-center gap-1 text-xs text-link underline-offset-2 hover:underline"
                  data-testid="member-console-link"
                >
                  <TerminalIcon className="size-3" aria-hidden="true" />
                  Open
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground">not running</span>
              )}
            </TableCell>
            {renderAction ? <TableCell className="text-right">{renderAction(m)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
