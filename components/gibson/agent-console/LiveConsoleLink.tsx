"use client";

/**
 * LiveConsoleLink, a link to a run's console pane that renders only while
 * that run is live (dashboard#1145). The mission page and the agents page
 * use it, so a person reaches the console from where they already are.
 */

import Link from "next/link";
import { TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consoleHref, useLiveRun, type LiveRunMatch } from "./useLiveRun";

interface LiveConsoleLinkProps {
  match: LiveRunMatch;
  /** Button size. The agents matrix uses "sm". */
  size?: "sm" | "default";
  className?: string;
}

export function LiveConsoleLink({ match, size = "default", className }: LiveConsoleLinkProps) {
  const run = useLiveRun(match);
  if (!run) return null;
  return (
    <Button asChild variant="outline" size={size} className={className}>
      <Link href={consoleHref(run.runId)} data-testid="live-console-link" data-run-id={run.runId}>
        <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        <TerminalIcon className="size-4" aria-hidden="true" />
        Live console
      </Link>
    </Button>
  );
}
