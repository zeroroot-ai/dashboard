"use client";

/**
 * AgentConsole, the read-only live console for a tenant's running agents
 * (ADR-0016 S12, dashboard#1134).
 *
 * It lists EVERY agent the tenant is running right now (requirement 1) and
 * gives each its own always-mounted terminal pane that streams that run's live
 * output independently (requirement 1: each streams on its own). The panes are
 * stacked, so several agents stream at once; a viewer can collapse the ones
 * they are not watching.
 *
 * The surface is READ-ONLY (requirement 2): it renders events only. There is
 * no input, no PTY, no command box, and no write path back to the agent. A
 * viewer who wants to drive an agent interactively runs it locally.
 *
 * Tenant isolation is enforced server-side: the list route and each stream
 * derive the tenant from the authenticated identity, and the daemon returns
 * only this tenant's instances. This component never re-filters and never
 * receives another tenant's data.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { BotIcon, TerminalIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { useRunningAgents } from "@/src/hooks/useRunningAgents";
import { useAgentConsole } from "@/src/hooks/useAgentConsole";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";

// xterm touches the DOM, so the terminal must load client-side only.
const MissionTerminal = dynamic(
  () =>
    import("@/src/components/missions/MissionTerminal").then(
      (m) => m.MissionTerminal,
    ),
  { ssr: false },
);

/** Formats an ISO start time for display, tolerating a bad value. */
function formatStarted(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * One running agent's pane: a header identifying the run and an always-mounted
 * terminal streaming its live output. The pane owns its own EventSource via
 * {@link useAgentConsole}, so every pane streams independently of the others.
 */
function AgentConsolePane({ agent }: { agent: RunningAgentView }) {
  const terminalRef = React.useRef<MissionTerminalHandle>(null);
  useAgentConsole(agent.runId, terminalRef);

  return (
    <Card data-testid="agent-console-pane" data-run-id={agent.runId}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <BotIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            {agent.agentName || agent.runId}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {agent.runId}
            </Badge>
            {agent.sandboxId ? (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                sandbox {agent.sandboxId}
              </Badge>
            ) : null}
            <span className="text-xs text-muted-foreground">
              started {formatStarted(agent.startedAt)}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <MissionTerminal
          ref={terminalRef}
          title={`${agent.agentName || agent.runId} · live output`}
          defaultOpen={true}
        />
      </CardContent>
    </Card>
  );
}

export function AgentConsole() {
  const { data: agents, isLoading, error } = useRunningAgents();

  if (isLoading) {
    return <TableSkeleton />;
  }

  if (error) {
    return (
      <ErrorAlert
        title="Could not load running agents"
        error={error instanceof Error ? error : { message: String(error) }}
      />
    );
  }

  const running = agents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <TerminalIcon className="size-5" aria-hidden="true" />
            Agent Console
          </h1>
          <p className="text-sm text-muted-foreground">
            A read-only, live view of the agents your tenant is running now.
          </p>
        </div>
        {running.length > 0 ? (
          <Badge variant="outline" data-testid="running-count">
            {running.length} running
          </Badge>
        ) : null}
      </div>

      {running.length === 0 ? (
        <EmptyState
          icon={BotIcon}
          title="No agents are running"
          description="When your tenant dispatches a coding agent, its live output shows up here."
        />
      ) : (
        <div className="space-y-4">
          {running.map((agent) => (
            <AgentConsolePane key={agent.runId} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
