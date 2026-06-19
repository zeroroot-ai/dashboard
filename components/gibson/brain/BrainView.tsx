"use client";

import { useEffect, useState } from "react";
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
type WorldData = {
  missions: Mission[];
  hosts: Host[];
  findings: Finding[];
  timeline: TimelineEvent[];
};

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
 * gibson#752): the live per-tenant World (missions, hosts, findings) plus the
 * Scroller — a scrubbable view of the mission's domain-event Timeline. Reads
 * through /api/world (the daemon's tenant-scoped WorldService); never touches
 * the brain directly.
 */
export function BrainView() {
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scrub, setScrub] = useState<number>(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await fetch("/api/world");
        if (!res.ok) throw new Error(`world read failed (${res.status})`);
        const json = (await res.json()) as WorldData;
        if (!active) return;
        setData(json);
        setScrub(json.timeline.length); // follow the live tail
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
  const shown = data.timeline.slice(0, scrub);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Missions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.missions.length === 0 ? (
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
                {data.missions.map((m) => (
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
          {data.hosts.length === 0 ? (
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
                {data.hosts.map((h) => (
                  <TableRow key={`${h.scopeId}/${h.address}`}>
                    <TableCell className="font-mono">
                      {h.address}
                      {h.surprise ? (
                        <Badge variant="destructive" className="ml-2">
                          anomaly
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{h.scopeId}</TableCell>
                    <TableCell className="font-mono">{h.openPorts.join(", ")}</TableCell>
                    <TableCell>{h.juicy.toFixed(2)}</TableCell>
                    <TableCell>{h.attention.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
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
          {data.findings.length === 0 ? (
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
                {data.findings.map((f) => (
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
              onValueChange={(v) => setScrub(v[0] ?? total)}
              className="max-w-md"
              aria-label="Scrub the mission timeline"
            />
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              {scrub} / {total} events
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
