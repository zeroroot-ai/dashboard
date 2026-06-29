"use client";

import { useCallback, useEffect, useState } from "react";
import { Pause, Play, Radio, SkipBack, SkipForward } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WorldGraph } from "@/components/gibson/brain/WorldGraph";
import { SPEED_OPTIONS, usePlayback } from "@/components/gibson/brain/playback";
import { TickInspector } from "@/components/gibson/brain/TickInspector";
import { diffFrames, type FrameDiff } from "@/components/gibson/brain/frame-diff";

type Mission = { id: string; goal: string; status: string; reason: string };
type Host = {
  scopeId: string;
  address: string;
  openPorts: number[];
  juicy: number;
  attention: number;
  surprise: string;
};
type Finding = {
  id: string;
  title: string;
  scopeId: string;
  address: string;
  severity: string;
};
type TimelineEvent = { seq: number; kind: string; summary: string };
type LlmCall = {
  callId: string;
  runId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
};

/** The entity slice rendered by the tables + graph — either the live World or
 *  a server-folded replay frame. */
type Frame = { missions: Mission[]; hosts: Host[]; findings: Finding[] };

// LLM calls are read from the live World (GetFrameAt folds entities, not the
// call log), so they live on WorldData rather than the scrubbable Frame.
type WorldData = Frame & { timeline: TimelineEvent[]; llmCalls: LlmCall[] };

function severityVariant(s: string): "destructive" | "secondary" | "outline" {
  const v = s.toLowerCase();
  if (v === "critical" || v === "high") return "destructive";
  if (v === "medium" || v === "low") return "secondary";
  return "outline";
}

function statusVariant(s: string): "default" | "secondary" {
  return s === "completed" ? "secondary" : "default";
}

/**
 * BrainView is the dashboard read view into the ECS brain (epic ecs-brain,
 * gibson#752): the live per-tenant World (missions, hosts, findings) shown as
 * both tables and a force-directed graph, plus the Scroller — a scrubbable view
 * of the mission's domain-event Timeline. Scrubbing fetches a server-side fold
 * of the log (`GetFrameAt`, ADR-0001: World == fold(Timeline)) so the tables and
 * graph re-materialize at that point in time, not a client-side slice. Reads
 * through /api/world + /api/world/frame (the daemon's tenant-scoped
 * WorldService); never touches the brain directly.
 *
 * When `mission` is set the view is scoped to that one mission run (gibson#1060):
 * the Timeline, the Scroller, and the entity panels all fold to the mission's
 * slice (the entity panels read the mission-scoped frame at every position,
 * including the live tail at seq == total). Absent a mission it stays the
 * tenant-wide World, unchanged.
 */
export function BrainView({ mission }: { mission?: string }) {
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The server-folded replay frame shown when scrubbed off the tail.
  const [frame, setFrame] = useState<Frame | null>(null);
  // The Timeline tick under inspection (0-based event seq), or null. Selecting a
  // tick folds frame(seq) vs frame(seq+1) to show what that event changed.
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);
  const [diff, setDiff] = useState<FrameDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // The pure playback controller (S5, gibson#1059) owns the scrub position:
  // play/pause/step/jump/speed/follow-tail. `total` is the live tail; when it
  // grows while following, the controller tracks it (live-tail follow). The
  // emitted position drives the same `/api/world/frame` fetch the slider used.
  const total = data ? data.timeline.length : 0;
  const playback = usePlayback(total);
  const scrub = playback.position;
  const atTail = playback.atTail;

  useEffect(() => {
    let active = true;
    // A new mission's Timeline re-indexes from 0, so any prior tick selection is
    // meaningless — clear the inspector.
    setSelectedSeq(null);
    const url = mission
      ? `/api/world?mission=${encodeURIComponent(mission)}`
      : "/api/world";
    const load = async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`world read failed (${res.status})`);
        const json = (await res.json()) as WorldData;
        if (!active) return;
        setData(json);
        // The playback controller advances the scrub head when following the
        // tail (it observes `total` growing), so no manual scrub bump here.
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "failed to load");
      }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [mission]);

  // Fetch the folded frame. Tenant-wide, only when scrubbed off the tail (the
  // tail renders live data). Mission-scoped, at EVERY position including the tail
  // — the entity panels must always reflect only this mission's slice, so even
  // the live frame (seq == total) comes from the mission-scoped fold. Debounced
  // and abortable so dragging the slider doesn't fire a request per pixel.
  useEffect(() => {
    if (!data) return;
    const total = data.timeline.length;
    if (!mission && scrub >= total) {
      setFrame(null); // tenant-wide at the tail → render live data
      return;
    }
    const seq = Math.min(scrub, total);
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ seq: String(seq) });
          if (mission) params.set("mission", mission);
          const res = await fetch(`/api/world/frame?${params.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) return;
          const json = (await res.json()) as Frame;
          setFrame(json);
        } catch {
          /* aborted or transient — keep the last frame */
        }
      })();
    }, 120);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [scrub, data, mission]);

  const onScrub = useCallback(
    (v: number[]) => {
      playback.controls.jump(v[0] ?? 0);
    },
    [playback.controls],
  );

  // Selecting a tick (a Scroller row) opens the inspector for event `seq` and
  // jumps the playback head to just after it, so the graph + tables show that
  // event's after-frame and the highlight (the diff delta) lands on rendered
  // nodes. Jump (S5) freezes follow-tail, so the replay frame stays put.
  const onSelectTick = useCallback(
    (seq: number) => {
      setSelectedSeq(seq);
      playback.controls.jump(seq + 1);
    },
    [playback.controls],
  );

  // Compute WHAT CHANGED at the selected tick by diffing the folded frame at
  // seq N-1 vs N (ADR-0001: World == fold(Timeline)). Both frames come from the
  // existing mission-scoped /api/world/frame route — no backend change. The diff
  // is pure + client-side (`diffFrames`). Degrades at seq 0 (before == empty
  // frame(0)) and on ticks with no entity change (empty diff). Abortable so a
  // rapid re-select doesn't race a stale diff in.
  useEffect(() => {
    if (selectedSeq === null) {
      setDiff(null);
      return;
    }
    const controller = new AbortController();
    setDiffLoading(true);
    void (async () => {
      try {
        const fetchFrame = async (seq: number): Promise<Frame> => {
          const params = new URLSearchParams({ seq: String(seq) });
          if (mission) params.set("mission", mission);
          const res = await fetch(`/api/world/frame?${params.toString()}`, {
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`frame read failed (${res.status})`);
          return (await res.json()) as Frame;
        };
        const [before, after] = await Promise.all([
          fetchFrame(selectedSeq),
          fetchFrame(selectedSeq + 1),
        ]);
        setDiff(diffFrames(before, after));
        setDiffLoading(false);
      } catch {
        /* aborted or transient — keep the last diff */
      }
    })();
    return () => controller.abort();
  }, [selectedSeq, mission]);

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-muted-foreground">
          Could not load the brain: {error}
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return <Skeleton className="h-96 w-full" />;
  }

  // Tenant-wide: render the folded frame when scrubbed, live data at the tail.
  // Mission-scoped: always render the mission's frame (entity panels reflect only
  // this mission); fall back to data only for the brief first-load flash.
  let view: Frame = data;
  if (mission) {
    view = frame ?? data;
  } else if (!atTail && frame) {
    view = frame;
  }
  const shown = data.timeline.slice(0, scrub);
  const selectedEvent =
    selectedSeq === null
      ? null
      : data.timeline.find((e) => e.seq === selectedSeq) ?? null;

  return (
    <div className="flex flex-col gap-6">
      {mission ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Viewing mission</p>
              <p className="truncate font-mono text-sm">{mission}</p>
            </div>
            <Badge variant={atTail ? "default" : "secondary"}>
              {atTail ? "live" : "replay"}
            </Badge>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>World</CardTitle>
        </CardHeader>
        <CardContent>
          <WorldGraph
            missions={view.missions}
            hosts={view.hosts}
            findings={view.findings}
            highlightNodeIds={selectedSeq === null ? undefined : diff?.highlightNodeIds}
            highlightEdgeIds={selectedSeq === null ? undefined : diff?.highlightEdgeIds}
          />
        </CardContent>
      </Card>

      {selectedSeq !== null && selectedEvent ? (
        <TickInspector
          event={selectedEvent}
          diff={diff}
          loading={diffLoading}
          onClose={() => setSelectedSeq(null)}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Missions</CardTitle>
        </CardHeader>
        <CardContent>
          {view.missions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No missions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Goal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.missions.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{m.goal}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(m.status)}>{m.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{m.reason}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Targets</CardTitle>
        </CardHeader>
        <CardContent>
          {view.hosts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hosts discovered yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Open ports</TableHead>
                  <TableHead>Juicy</TableHead>
                  <TableHead>Attention</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Juiciest targets first: the belief field (ADR-0005) drives
                    attention, so sorting by it surfaces the highest-value hosts. */}
                {[...view.hosts]
                  .sort((a, b) => b.attention - a.attention)
                  .map((h) => {
                    const juicyTarget = h.juicy >= 0.5;
                    return (
                      <TableRow key={`${h.scopeId}/${h.address}`}>
                        <TableCell className="font-mono">
                          {h.address}
                          {juicyTarget ? (
                            <Badge className="ml-2">juicy</Badge>
                          ) : null}
                          {h.surprise ? (
                            <Badge variant="destructive" className="ml-2">
                              anomaly
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{h.scopeId}</TableCell>
                        <TableCell className="font-mono">{h.openPorts.join(", ")}</TableCell>
                        <TableCell className={juicyTarget ? "text-highlight font-semibold" : undefined}>
                          {h.juicy.toFixed(2)}
                        </TableCell>
                        <TableCell>{h.attention.toFixed(2)}</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
        </CardHeader>
        <CardContent>
          {view.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No findings yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Finding</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.findings.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell>{f.title}</TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(f.severity)}>{f.severity}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{f.address}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* LLM calls are tenant-wide: the call log carries no mission linkage yet
          (mission-scoped LLM provenance is the rich-frame projection, M2), so
          this panel is shown only in the tenant-wide view to avoid implying a
          single mission's calls. */}
      {mission ? null : (
      <Card>
        <CardHeader>
          <CardTitle>LLM calls</CardTitle>
        </CardHeader>
        <CardContent>
          {data.llmCalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No LLM calls yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Prompt</TableHead>
                  <TableHead className="text-right">Completion</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.llmCalls.map((c) => (
                  <TableRow key={c.callId}>
                    <TableCell className="font-mono">{c.model}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.promptTokens}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.completionTokens}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {c.promptTokens + c.completionTokens}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Scroller</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={playback.controls.stepBack}
              disabled={scrub <= 0}
              aria-label="Step back one event"
            >
              <SkipBack />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={playback.controls.toggle}
              disabled={total === 0 || (atTail && !playback.playing)}
              aria-label={playback.playing ? "Pause playback" : "Play"}
              aria-pressed={playback.playing}
            >
              {playback.playing ? <Pause /> : <Play />}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={playback.controls.stepForward}
              disabled={scrub >= total}
              aria-label="Step forward one event"
            >
              <SkipForward />
            </Button>
            <Button
              type="button"
              variant={atTail ? "secondary" : "outline"}
              size="sm"
              onClick={playback.controls.followTail}
              disabled={atTail}
              aria-label="Follow the live tail"
            >
              <Radio />
              Live
            </Button>
            <Select
              value={String(playback.speed)}
              onValueChange={(v) => playback.controls.setSpeed(Number(v))}
            >
              <SelectTrigger
                className="h-8 w-20"
                aria-label="Playback speed"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPEED_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}x
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <Slider
              value={[scrub]}
              max={total}
              step={1}
              onValueChange={onScrub}
              className="max-w-md"
              aria-label="Scrub the mission timeline"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {scrub} / {total} events
              {atTail ? " · live" : " · replay"}
            </span>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="flex flex-col gap-1 font-mono text-sm">
              {shown.map((e) => (
                <li key={e.seq}>
                  <button
                    type="button"
                    onClick={() => onSelectTick(e.seq)}
                    aria-pressed={selectedSeq === e.seq}
                    className="flex w-full gap-3 rounded px-1 py-0.5 text-left hover:bg-accent aria-pressed:bg-accent"
                  >
                    <span className="text-muted-foreground tabular-nums">{e.seq}</span>
                    <span className="text-foreground">{e.kind}</span>
                    <span className="text-muted-foreground truncate">{e.summary}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
