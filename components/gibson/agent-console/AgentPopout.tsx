"use client";

/**
 * AgentPopout, one tile opened near-full-screen over the wall
 * (dashboard#1147).
 *
 * It shows the same live stream as the tile. The stream registry hands the
 * pop-out the tile's stream, so the terminal replays the tile's buffer and
 * then follows live. Nothing reconnects. A meta rail shows the run's facts
 * and actions. Esc closes. Left and Right move to the previous and the next
 * running agent. Focus stays inside while open and returns to the tile on
 * close.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
  SquareIcon,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useStopMission } from "@/src/hooks/useMissions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAgentConsole, type AgentConsolePhase } from "@/src/hooks/useAgentConsole";
import { formatCost, formatDuration, shortId } from "@/src/lib/agent-console/stream-json";
import type { RunningAgentView } from "@/src/lib/gibson-client/agent-console";
import type { MissionTerminalHandle } from "@/src/components/missions/MissionTerminal";
import { cn } from "@/lib/utils";

// xterm touches the DOM, so the terminal must load client-side only.
const TileTerminal = dynamic(
  () =>
    import("@/components/gibson/agent-console/TileTerminal").then(
      (m) => m.TileTerminal,
    ),
  { ssr: false },
);

const PHASE_LABEL: Record<AgentConsolePhase, string> = {
  streaming: "live",
  finished: "finished",
  gone: "stopped",
  error: "stream error",
};

const DOT_CLASS: Record<AgentConsolePhase, string> = {
  streaming: "bg-primary animate-pulse motion-reduce:animate-none",
  finished: "bg-muted-foreground",
  gone: "bg-muted-foreground/50",
  error: "bg-destructive",
};

/** Elapsed time since `startedAt`, ticking while the run streams. */
function useElapsed(startedAt: string, running: boolean): string | null {
  const start = new Date(startedAt).getTime();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (isNaN(start)) return null;
  return formatDuration(Math.max(0, now - start));
}

function formatStarted(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/** Stops the mission behind a run after a confirmation. */
function StopMissionButton({ missionId, agentName }: { missionId: string; agentName: string }) {
  const stop = useStopMission();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          className="justify-start text-xs"
          disabled={stop.isPending}
          data-testid="popout-stop-mission"
        >
          <SquareIcon className="size-3.5" />
          Stop mission
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this mission?</AlertDialogTitle>
          <AlertDialogDescription>
            This stops mission {missionId} and ends the {agentName} run. The agent loses
            work it has not checkpointed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep running</AlertDialogCancel>
          <AlertDialogAction
            data-testid="popout-stop-confirm"
            onClick={() =>
              stop.mutate(missionId, {
                onSuccess: () => toast.success("Mission stopped"),
                onError: (err) => toast.error(`Failed to stop mission: ${err.message}`),
              })
            }
          >
            Stop mission
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Fact({ label, value, mono = true }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-all text-xs text-foreground", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

interface AgentPopoutProps {
  /** The run shown, or null when the pop-out is closed. */
  agent: RunningAgentView | null;
  /** Position of the run on the wall and the wall size, for navigation. */
  index: number;
  count: number;
  onClose: () => void;
  /** Moves to the previous (-1) or the next (+1) running agent. */
  onNavigate: (delta: 1 | -1) => void;
  /** Called on close, so focus can return to the tile. */
  onCloseAutoFocus?: (e: Event) => void;
}

function PopoutBody({
  agent,
  index,
  count,
  onNavigate,
}: Pick<AgentPopoutProps, "agent" | "index" | "count" | "onNavigate"> & { agent: RunningAgentView }) {
  const terminalRef = React.useRef<MissionTerminalHandle>(null);
  const status = useAgentConsole(agent.runId, terminalRef);
  const running = status.phase === "streaming";
  const elapsed = useElapsed(agent.startedAt, running);
  const name = agent.agentName || agent.runId;
  const { model, sessionId, turns, costUsd, durationMs } = status.summary;
  const [copied, setCopied] = React.useState(false);

  const copyRunId = async () => {
    try {
      await navigator.clipboard.writeText(agent.runId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable; the id stays visible in the rail.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2">
        <span
          data-testid="popout-dot"
          className={cn("size-2.5 shrink-0 rounded-full", DOT_CLASS[status.phase])}
          role="img"
          aria-label={PHASE_LABEL[status.phase]}
        />
        <DialogTitle className="min-w-0 truncate text-base font-semibold">{name}</DialogTitle>
        <span className="font-mono text-xs text-muted-foreground" title={agent.runId}>
          {shortId(agent.runId)}
        </span>
        <DialogDescription className="sr-only">
          Sandbox output of {name}. Press Escape to close, Left or Right to move between sandboxes.
        </DialogDescription>
        <span className="ml-auto flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Previous sandbox"
            disabled={count <= 1}
            onClick={() => onNavigate(-1)}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <span data-testid="popout-position" className="tabular-nums">
            {index + 1} / {count}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Next sandbox"
            disabled={count <= 1}
            onClick={() => onNavigate(1)}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 bg-terminal">
          <TileTerminal
            ref={terminalRef}
            title={`${name} · sandbox output`}
            height="fill"
            fontSize={14}
          />
        </div>
        <aside
          data-testid="popout-rail"
          aria-label="Run details"
          className="hidden w-56 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-muted/30 p-3 md:flex"
        >
          <dl className="flex flex-col gap-3">
            <Fact label="status" value={PHASE_LABEL[status.phase]} mono={false} />
            <Fact label="agent" value={name} />
            <Fact label="run id" value={agent.runId} />
            {agent.missionId ? <Fact label="mission" value={agent.missionId} /> : null}
            {agent.missionRunId ? <Fact label="mission run" value={agent.missionRunId} /> : null}
            {agent.sandboxId ? <Fact label="sandbox" value={agent.sandboxId} /> : null}
            {agent.sandboxClass ? <Fact label="sandbox class" value={agent.sandboxClass} /> : null}
            {model ? <Fact label="model" value={model} /> : null}
            {sessionId ? <Fact label="session" value={shortId(sessionId)} /> : null}
            <Fact label="started" value={formatStarted(agent.startedAt)} mono={false} />
            {elapsed !== null ? <Fact label="elapsed" value={elapsed} /> : null}
            {turns !== undefined ? <Fact label="turns" value={turns} /> : null}
            {costUsd !== undefined ? <Fact label="cost so far" value={formatCost(costUsd)} /> : null}
            {durationMs !== undefined ? <Fact label="agent time" value={formatDuration(durationMs)} /> : null}
          </dl>
          <div className="mt-auto flex flex-col gap-2">
            {agent.missionId ? (
              <Button asChild variant="outline" size="sm" className="justify-start text-xs">
                <Link href={`/dashboard/results/${encodeURIComponent(agent.missionId)}`} data-testid="popout-open-mission">
                  <ExternalLinkIcon className="size-3.5" />
                  Open mission
                </Link>
              </Button>
            ) : null}
            {agent.missionId && running ? (
              <StopMissionButton missionId={agent.missionId} agentName={name} />
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start text-xs"
              onClick={copyRunId}
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
              {copied ? "Copied" : "Copy run id"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

export function AgentPopout({ agent, index, count, onClose, onNavigate, onCloseAutoFocus }: AgentPopoutProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onNavigate(-1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onNavigate(1);
    }
  };

  return (
    <Dialog open={agent !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        data-testid="agent-popout"
        className="flex h-[92vh] w-[96vw] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[96vw]"
        onKeyDown={handleKeyDown}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {agent ? <PopoutBody agent={agent} index={index} count={count} onNavigate={onNavigate} /> : null}
      </DialogContent>
    </Dialog>
  );
}
