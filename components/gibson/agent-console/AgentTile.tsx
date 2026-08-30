"use client";

/**
 * AgentTile, one live tile on the Ops wall (dashboard#1146).
 *
 * A compact header (status dot, agent name, short run id, elapsed time,
 * cost so far) over a fixed-height terminal that streams this run's output.
 * The tile owns its own EventSource via useAgentConsole, so every tile
 * streams independently. It reports its stream facts to the wall through
 * `onFacts`, so the wall can sort by cost.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { useAgentConsole, type AgentConsolePhase } from "@/src/hooks/useAgentConsole";
import { formatCost, formatDuration, shortId } from "@/src/lib/agent-console/stream-json";
import type { WallTileFacts } from "@/src/lib/agent-console/wall";
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

/**
 * Elapsed time since `startedAt`, ticking once a second while the run
 * streams and frozen once it stops. Returns null for a bad start time.
 */
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

const PHASE_LABEL: Record<AgentConsolePhase, string> = {
  streaming: "live",
  finished: "finished",
  gone: "stopped",
  error: "stream error",
};

const DOT_CLASS: Record<AgentConsolePhase, string> = {
  streaming: "bg-primary animate-pulse",
  finished: "bg-muted-foreground",
  gone: "bg-muted-foreground/50",
  error: "bg-destructive",
};

interface AgentTileProps {
  agent: RunningAgentView;
  /** Fixed terminal height in pixels. */
  height: number;
  /** Terminal font size in pixels. */
  fontSize: number;
  /** Receives the run facts the stream reveals (cost so far). */
  onFacts?: (runId: string, facts: WallTileFacts) => void;
  /** Opens this run in the pop-out (click, Enter or F). */
  onOpen?: (runId: string) => void;
  /** True while this run is open in the pop-out. */
  selected?: boolean;
}

/**
 * True while the element is in the viewport. Without IntersectionObserver
 * (older browsers, tests) every tile counts as visible.
 */
function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = React.useState(true);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setInView(entry.isIntersecting);
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return inView;
}

export const AgentTile = React.forwardRef<HTMLElement, AgentTileProps>(function AgentTile(
  { agent, height, fontSize, onFacts, onOpen, selected = false },
  ref,
) {
  const terminalRef = React.useRef<MissionTerminalHandle>(null);
  const sectionRef = React.useRef<HTMLElement | null>(null);
  const inView = useInView(sectionRef);
  const status = useAgentConsole(agent.runId, terminalRef, { live: inView });
  const running = status.phase === "streaming";
  const elapsed = useElapsed(agent.startedAt, running);
  const name = agent.agentName || agent.runId;
  const { costUsd, model, turns } = status.summary;

  React.useEffect(() => {
    if (costUsd !== undefined) onFacts?.(agent.runId, { costUsd });
  }, [agent.runId, costUsd, onFacts]);

  const open = () => onOpen?.(agent.runId);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === "f" || e.key === "F") {
      e.preventDefault();
      open();
    }
  };

  return (
    <section
      ref={(el) => {
        sectionRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      data-testid="agent-tile"
      data-run-id={agent.runId}
      data-phase={status.phase}
      data-live={inView ? "true" : "false"}
      data-selected={selected ? "true" : undefined}
      aria-label={`${name} ${shortId(agent.runId)}`}
      tabIndex={0}
      onClick={open}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-md border border-border outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring",
        selected && "ring-2 ring-primary",
      )}
      style={{ backgroundColor: "var(--terminal-bg)" }}
    >
      <header
        data-testid="agent-tile-header"
        className="flex min-w-0 items-center gap-2 border-b border-border bg-muted/40 px-2 py-1 font-mono text-xs"
      >
        <span
          data-testid="agent-tile-dot"
          className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[status.phase])}
          role="img"
          aria-label={PHASE_LABEL[status.phase]}
          title={PHASE_LABEL[status.phase]}
        />
        <span className="min-w-0 truncate font-semibold text-foreground" title={name}>
          {name}
        </span>
        <span className="shrink-0 text-muted-foreground" title={agent.runId}>
          {shortId(agent.runId)}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-3 tabular-nums text-muted-foreground">
          {model ? (
            <span className="hidden xl:inline" title="model">
              {model}
            </span>
          ) : null}
          {turns !== undefined ? <span title="turns">{turns}t</span> : null}
          {elapsed !== null ? (
            <span className="text-foreground" title="elapsed">
              {elapsed}
            </span>
          ) : null}
          {costUsd !== undefined ? (
            <span className="text-foreground" title="cost so far">
              {formatCost(costUsd)}
            </span>
          ) : null}
        </span>
      </header>
      <TileTerminal
        ref={terminalRef}
        title={`${name} · live output`}
        height={height}
        fontSize={fontSize}
      />
    </section>
  );
});
