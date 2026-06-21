"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { WorldGraph } from "@/components/gibson/brain/WorldGraph";

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

/** The entity slice rendered by the tables + graph — either the live World or
 *  a server-folded replay frame. */
type Frame = { missions: Mission[]; hosts: Host[]; findings: Finding[] };

type WorldData = Frame & { timeline: TimelineEvent[] };

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
 */
export function BrainView() {
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number>(0);
  // Whether the Scroller is pinned to the live tail. While following, the 5s
  // refresh advances the scrub head; once the user scrubs back it freezes.
  const followTail = useRef(true);
  // The server-folded replay frame shown when scrubbed off the tail.
  const [frame, setFrame] = useState<Frame | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/world");
        if (!res.ok) throw new Error(`world read failed (${res.status})`);
        const json = (await res.json()) as WorldData;
        if (!active) return;
        setData(json);
        if (followTail.current) setScrub(json.timeline.length);
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
  }, []);

  // Fetch the folded frame whenever the user scrubs off the tail. Debounced and
  // abortable so dragging the slider doesn't fire a request per pixel.
  useEffect(() => {
    if (!data) return;
    if (scrub >= data.timeline.length) {
      setFrame(null); // at the tail → render live data
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/world/frame?seq=${scrub}`, {
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
  }, [scrub, data]);

  const onScrub = useCallback(
    (v: number[], total: number) => {
      const next = v[0] ?? total;
      setScrub(next);
      followTail.current = next >= total;
    },
    [],
  );

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

  const total = data.timeline.length;
  const atTail = scrub >= total;
  // Tables + graph render the folded frame when scrubbed, live data at the tail.
  const view: Frame = atTail || !frame ? data : frame;
  const shown = data.timeline.slice(0, scrub);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>World</CardTitle>
        </CardHeader>
        <CardContent>
          <WorldGraph
            missions={view.missions}
            hosts={view.hosts}
            findings={view.findings}
          />
        </CardContent>
      </Card>

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

      <Card>
        <CardHeader>
          <CardTitle>Scroller</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Slider
              value={[scrub]}
              max={total}
              step={1}
              onValueChange={(v) => onScrub(v, total)}
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
                <li key={e.seq} className="flex gap-3">
                  <span className="text-muted-foreground tabular-nums">{e.seq}</span>
                  <span className="text-foreground">{e.kind}</span>
                  <span className="text-muted-foreground truncate">{e.summary}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
