"use client";

/**
 * AgentConsole, the read-only Ops wall for a tenant's running agents
 * (ADR-0016 S12, dashboard#1134, dashboard#1146).
 *
 * It lists EVERY agent the tenant is running right now and gives each its
 * own always-mounted tile that streams that run's live output. The wall
 * fits however many agents run: one agent is one full pane, two to four are
 * halves, up to nine are thirds, up to twenty-five are five columns, and
 * more are six columns. The viewer picks a density and a sort order, and
 * both persist in browser storage.
 *
 * Only tiles in view hold a live stream, and the page never holds more
 * than a cap of open streams; the rest queue and the header says so
 * (dashboard#1148).
 *
 * A tile pops out near-full-screen on click, Enter or F (dashboard#1147).
 * The pop-out shares the tile's stream through one registry per wall, so
 * nothing reconnects. The URL carries `?run=<id>` while a pop-out is open,
 * so a pop-out is linkable.
 *
 * A tile that shows a bank member (gibson#1706) gains the member's state
 * and a job panel with a compose box, so a person can give it structured
 * jobs. Every other tile is read-only: events only, no input, no PTY.
 *
 * Tenant isolation is enforced server-side: the list route and each stream
 * derive the tenant from the authenticated identity, and the daemon returns
 * only this tenant's instances. This component never re-filters.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BotIcon, TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { useRunningAgents } from "@/src/hooks/useRunningAgents";
import { useMemberRuns } from "@/src/hooks/useMemberRuns";
import { AgentStreamRegistryContext } from "@/src/hooks/useAgentConsole";
import { AgentStreamRegistry } from "@/src/lib/agent-console/stream";
import {
  RIBBON_MS,
  WALL_DENSITIES,
  WALL_SORTS,
  foldSeenRuns,
  pickChoice,
  ribbonLabel,
  sortRunning,
  splitWall,
  tileFontSize,
  tileHeight,
  wallColumns,
  type SeenRun,
  type WallSort,
  type WallTileFacts,
} from "@/src/lib/agent-console/wall";
import { formatDuration, shortId } from "@/src/lib/agent-console/stream-json";
import { AgentTile } from "./AgentTile";
import { AgentPopout } from "./AgentPopout";

const DENSITY_KEY = "agent-console.density";
const SORT_KEY = "agent-console.sort";

/**
 * A choice that persists in browser storage for this viewer. The stored
 * value is read after mount, so server and first client render agree.
 */
function usePersistedChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = React.useState<T>(fallback);
  React.useEffect(() => {
    try {
      setValue(pickChoice(localStorage.getItem(key), allowed, fallback));
    } catch {
      // Storage is unavailable; the fallback stays.
    }
  }, [key, allowed, fallback]);
  const set = React.useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Storage is unavailable; the choice lives for this page only.
      }
    },
    [key],
  );
  return [value, set];
}

const RUN_PARAM = "run";

/**
 * The run open in the pop-out, mirrored in the URL as `?run=<id>`. The URL
 * is the source of truth, so a deep link opens the pop-out on load and
 * Back closes it.
 */
function useSelectedRun(): [string | null, (runId: string | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get(RUN_PARAM);
  const setSelected = React.useCallback(
    (runId: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (runId) next.set(RUN_PARAM, runId);
      else next.delete(RUN_PARAM);
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, params],
  );
  return [selected, setSelected];
}

const SORT_LABEL: Record<WallSort, string> = {
  started: "Started",
  name: "Name",
  cost: "Cost",
};

export function AgentConsole() {
  const { data: agents, isLoading, error } = useRunningAgents();
  const memberRuns = useMemberRuns();
  const [density, setDensity] = usePersistedChoice(DENSITY_KEY, WALL_DENSITIES, "comfortable");
  const [sort, setSort] = usePersistedChoice(SORT_KEY, WALL_SORTS, "started");
  const [facts, setFacts] = React.useState<ReadonlyMap<string, WallTileFacts>>(
    () => new Map(),
  );
  const [registry] = React.useState(() => new AgentStreamRegistry());
  const [streamStats, setStreamStats] = React.useState(() => registry.stats());
  React.useEffect(() => registry.onStats(setStreamStats), [registry]);
  const [selectedRun, setSelectedRun] = useSelectedRun();
  const tileRefs = React.useRef(new Map<string, HTMLElement>());
  // The run that was open last, so focus can return to its tile after the
  // URL has already dropped ?run=.
  const lastSelectedRef = React.useRef<string | null>(null);
  if (selectedRun) lastSelectedRef.current = selectedRun;
  const onFacts = React.useCallback((runId: string, next: WallTileFacts) => {
    setFacts((prev) => {
      const cur = prev.get(runId);
      if (cur && cur.costUsd === next.costUsd && cur.ended === next.ended) return prev;
      const out = new Map(prev);
      out.set(runId, { ...cur, ...next });
      return out;
    });
  }, []);

  // A finished run stays on the wall for a minute with a ribbon, then folds
  // into the recent list. `seen` remembers every run this page showed.
  const [seen, setSeen] = React.useState<ReadonlyMap<string, SeenRun>>(() => new Map());
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!agents) return;
    setSeen((prev) => foldSeenRuns(prev, agents, facts, Date.now()));
  }, [agents, facts]);
  const hasRibbon = React.useMemo(
    () => [...seen.values()].some((r) => r.endedAt !== undefined && now - r.endedAt < RIBBON_MS),
    [seen, now],
  );
  React.useEffect(() => {
    if (!hasRibbon) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasRibbon]);

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

  const { tiles, recent } = splitWall(seen, now);
  const running = sortRunning(
    tiles.map((r) => r.agent),
    sort,
    facts,
  );
  const liveCount = (agents ?? []).length;
  const columns = wallColumns(running.length);
  const height = tileHeight(columns, density);
  const fontSize = tileFontSize(density);
  const selectedIndex = selectedRun ? running.findIndex((a) => a.runId === selectedRun) : -1;
  const selectedAgent = selectedIndex >= 0 ? running[selectedIndex] : null;
  const navigate = (delta: 1 | -1) => {
    if (running.length === 0 || selectedIndex < 0) return;
    const next = (selectedIndex + delta + running.length) % running.length;
    setSelectedRun(running[next].runId);
  };
  const returnFocusToTile = (e: Event) => {
    const last = lastSelectedRef.current;
    const tile = last ? tileRefs.current.get(last) : undefined;
    if (tile) {
      e.preventDefault();
      tile.focus();
    }
  };

  return (
    <AgentStreamRegistryContext.Provider value={registry}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <TerminalIcon className="size-5" aria-hidden="true" />
            Agent Sandboxes
          </h1>
          <p className="text-sm text-muted-foreground">
            Every agent and tool your tenant runs in an isolated setec sandbox,
            live. Bank members take jobs from here.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {liveCount > 0 ? (
            <Badge variant="outline" data-testid="running-count">
              {liveCount} running
            </Badge>
          ) : null}
          {running.length > 0 ? (
            <Badge
              variant="outline"
              data-testid="stream-stats"
              className="tabular-nums"
              title="Open live streams on this page, out of the cap. Tiles out of view free their slot."
            >
              live {streamStats.live}/{streamStats.cap}
              {streamStats.waiting > 0 ? ` · ${streamStats.waiting} waiting` : ""}
            </Badge>
          ) : null}
          <div
            role="group"
            aria-label="Tile density"
            className="flex overflow-hidden rounded-md border border-border"
          >
            {WALL_DENSITIES.map((d) => (
              <Button
                key={d}
                type="button"
                variant={density === d ? "secondary" : "ghost"}
                size="sm"
                className="h-7 rounded-none px-2 text-xs capitalize"
                aria-pressed={density === d}
                data-testid={`density-${d}`}
                onClick={() => setDensity(d)}
              >
                {d}
              </Button>
            ))}
          </div>
          <Select value={sort} onValueChange={(v) => setSort(pickChoice(v, WALL_SORTS, "started"))}>
            <SelectTrigger
              size="sm"
              className="h-7 w-[7.5rem] text-xs"
              aria-label="Sort tiles"
              data-testid="sort-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WALL_SORTS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {SORT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {running.length === 0 ? (
        <EmptyState
          icon={BotIcon}
          title="No sandboxes are running"
          description="When a mission dispatches an agent or runs a tool, it gets its own sandbox and its output shows up here. Launch a mission, or enable an agent from the catalog first."
          primaryCta={
            <Button asChild>
              <Link href="/dashboard/missions">Launch a mission</Link>
            </Button>
          }
          secondaryCta={
            <Button asChild variant="outline">
              <Link href="/dashboard/agents">Enable an agent</Link>
            </Button>
          }
        />
      ) : (
        <div
          data-testid="agent-wall"
          data-columns={columns}
          data-density={density}
          className="grid w-full min-w-0 gap-3"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {running.map((agent) => (
            <AgentTile
              key={agent.runId}
              ref={(el) => {
                if (el) tileRefs.current.set(agent.runId, el);
                else tileRefs.current.delete(agent.runId);
              }}
              agent={agent}
              height={height}
              fontSize={fontSize}
              onFacts={onFacts}
              onOpen={setSelectedRun}
              selected={agent.runId === selectedRun}
              ribbon={
                seen.get(agent.runId)?.endedAt !== undefined
                  ? ribbonLabel(seen.get(agent.runId)?.ended)
                  : undefined
              }
              member={memberRuns.get(agent.runId)}
            />
          ))}
        </div>
      )}
      {recent.length > 0 ? (
        <section aria-labelledby="recent-runs-heading" className="space-y-2">
          <h2 id="recent-runs-heading" className="text-sm font-semibold">
            Recent runs
          </h2>
          <ul data-testid="recent-runs" className="divide-y divide-border rounded-md border border-border">
            {recent.map((run) => (
              <li
                key={run.agent.runId}
                data-testid="recent-run"
                data-run-id={run.agent.runId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 font-mono text-xs"
              >
                <span className="font-semibold text-foreground">{run.agent.agentName || run.agent.runId}</span>
                <span className="text-muted-foreground" title={run.agent.runId}>
                  {shortId(run.agent.runId)}
                </span>
                <Badge variant="outline" className="text-[0.65rem]">
                  {ribbonLabel(run.ended)}
                </Badge>
                {run.endedAt !== undefined ? (
                  <span className="text-muted-foreground">
                    ended {formatDuration(now - run.endedAt)} ago
                  </span>
                ) : null}
                {run.agent.missionId ? (
                  <Link
                    href={`/dashboard/results/${encodeURIComponent(run.agent.missionId)}`}
                    className="ml-auto text-primary underline-offset-2 hover:underline"
                  >
                    Open mission
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <AgentPopout
        agent={selectedAgent}
        index={selectedIndex}
        count={running.length}
        onClose={() => setSelectedRun(null)}
        onNavigate={navigate}
        onCloseAutoFocus={returnFocusToTile}
        member={selectedAgent ? memberRuns.get(selectedAgent.runId) : undefined}
      />
    </div>
    </AgentStreamRegistryContext.Provider>
  );
}
