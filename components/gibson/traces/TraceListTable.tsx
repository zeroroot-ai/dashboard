"use client";

/**
 * TraceListTable — client component backing /dashboard/traces.
 *
 * Lists every Gibson Trace for the tenant across all missions. Date range and
 * name filters are URL-driven (?from=&to=&name=&page=) so the view is
 * shareable, matching the pattern in UsageContent. Rows link to the standalone
 * trace detail page (dashboard#470).
 */

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTokenCount } from "@/src/lib/trace-utils";
import type { TraceListResponse, TraceSummary } from "@/src/types/trace";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatLatency(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TraceListTable() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const name = searchParams.get("name") ?? "";
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [data, setData] = React.useState<TraceListResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Local controlled value for the debounced name filter.
  const [nameInput, setNameInput] = React.useState(name);
  React.useEffect(() => setNameInput(name), [name]);

  const setParam = React.useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      // Any filter change resets to page 1 unless page itself is being set.
      if (!("page" in updates)) next.delete("page");
      router.replace(`/dashboard/traces?${next.toString()}`);
    },
    [router, searchParams],
  );

  // Debounce the name filter into the URL.
  React.useEffect(() => {
    if (nameInput === name) return;
    const handle = setTimeout(() => setParam({ name: nameInput || null }), 400);
    return () => clearTimeout(handle);
  }, [nameInput, name, setParam]);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const qs = new URLSearchParams();
    qs.set("page", String(page));
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (name) qs.set("name", name);

    (async () => {
      try {
        const res = await fetch(`/api/traces?${qs.toString()}`);
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setError(body?.error?.message ?? "Failed to load traces");
          setData(null);
        } else {
          setData((await res.json()) as TraceListResponse);
        }
      } catch {
        if (!cancelled) setError("Failed to load traces");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, from, to, name]);

  const rows: TraceSummary[] = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Gibson Traces</CardTitle>
        <CardDescription>
          Every AI run across your missions — token usage, model activity, and
          the full prompt/response detail for each call.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3 max-w-2xl">
          <div className="space-y-1.5">
            <Label htmlFor="from">From</Label>
            <Input
              id="from"
              type="date"
              defaultValue={from}
              onChange={(e) => setParam({ from: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to">To</Label>
            <Input
              id="to"
              type="date"
              defaultValue={to}
              onChange={(e) => setParam({ to: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              type="search"
              placeholder="Filter by name"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No traces found for the selected filters.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trace</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((trace) => (
                  <TableRow
                    key={trace.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/dashboard/traces/${trace.id}`)}
                  >
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/dashboard/traces/${trace.id}`}
                        className="text-link hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {trace.name || trace.id}
                      </Link>
                      {trace.sessionId && (
                        <span className="block text-muted-foreground">
                          {trace.sessionId}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {formatTimestamp(trace.timestamp)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          trace.status === "error"
                            ? "border-destructive/50 text-destructive"
                            : "border-highlight/50 text-highlight"
                        }
                      >
                        {trace.status === "error" ? "Error" : "OK"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatTokenCount(trace.totalTokens)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatLatency(trace.latencyMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setParam({ page: String(page - 1) })}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setParam({ page: String(page + 1) })}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
