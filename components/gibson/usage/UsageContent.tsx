"use client";

/**
 * UsageContent — client component backing /dashboard/pages/usage.
 *
 * Renders four tables (by user, team, agent, mission) sourced from the
 * daemon's UsageService via the getLlmUsage Server Action. Time range
 * is URL-driven (?from=YYYY-MM-DD&to=YYYY-MM-DD) so the view is
 * shareable; defaults to month-to-date.
 *
 * Non-admin callers see only the "My usage" single-row view — the
 * Server Action already narrows server-side, but hiding the admin
 * tabs keeps the UI from teasing data the caller can't see.
 *
 * Spec: llm-user-attribution-governance (Requirement 2).
 */

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getLlmUsageAction,
  type UsageRow,
  type UsageScopeInput,
} from "@/app/actions/read/getLlmUsage";

type Props = {
  fromParam?: string;
  toParam?: string;
  scopeParam?: string;
};

const SCOPES: UsageScopeInput[] = ["user", "team", "agent", "mission"];

function parseDateToUnix(s?: string): number | undefined {
  if (!s) return undefined;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  return Math.floor(d.getTime() / 1000);
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

export function UsageContent({ fromParam, toParam, scopeParam }: Props) {
  const initialScope = (SCOPES as string[]).includes(scopeParam ?? "")
    ? (scopeParam as UsageScopeInput)
    : "user";

  const [scope, setScope] = useState<UsageScopeInput>(initialScope);
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staleAsOfUnix, setStaleAsOfUnix] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const res = await getLlmUsageAction({
        scope,
        fromUnix: parseDateToUnix(fromParam),
        toUnix: parseDateToUnix(toParam),
      });
      if (cancelled) return;
      if (res.ok) {
        setRows(res.data.rows);
        setStaleAsOfUnix(res.data.staleAsOfUnix);
      } else {
        setError(res.error);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, fromParam, toParam]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LLM usage</CardTitle>
          <CardDescription>
            Token consumption and spend across the tenant. Non-admins see
            only their own row.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 max-w-xl mb-4">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                defaultValue={fromParam}
                onChange={(e) => {
                  const u = new URL(window.location.href);
                  if (e.target.value) u.searchParams.set("from", e.target.value);
                  else u.searchParams.delete("from");
                  window.location.href = u.toString();
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                defaultValue={toParam}
                onChange={(e) => {
                  const u = new URL(window.location.href);
                  if (e.target.value) u.searchParams.set("to", e.target.value);
                  else u.searchParams.delete("to");
                  window.location.href = u.toString();
                }}
              />
            </div>
          </div>

          <Tabs value={scope} onValueChange={(v) => setScope(v as UsageScopeInput)}>
            <TabsList>
              <TabsTrigger value="user">By user</TabsTrigger>
              <TabsTrigger value="team">By team</TabsTrigger>
              <TabsTrigger value="agent">By agent</TabsTrigger>
              <TabsTrigger value="mission">By mission</TabsTrigger>
            </TabsList>
            {SCOPES.map((s) => (
              <TabsContent key={s} value={s} className="pt-4">
                {loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : error ? (
                  <p className="text-sm text-destructive">Error: {error}</p>
                ) : rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No usage recorded in this range for the selected scope.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {s === "user"
                            ? "User"
                            : s === "team"
                              ? "Team"
                              : s === "agent"
                                ? "Agent"
                                : "Mission"}
                        </TableHead>
                        <TableHead className="text-right">Input tokens</TableHead>
                        <TableHead className="text-right">Output tokens</TableHead>
                        <TableHead className="text-right">Cost (USD)</TableHead>
                        <TableHead className="text-right">Traces</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.subjectId}>
                          <TableCell className="font-mono text-xs">
                            {r.displayName || r.subjectId}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatTokens(r.inputTokens)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatTokens(r.outputTokens)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatDollars(r.costUsdCents)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatTokens(r.traceCount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </TabsContent>
            ))}
          </Tabs>

          {staleAsOfUnix > 0 && (
            <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
              Data may be up to{" "}
              {Math.round((Date.now() / 1000 - staleAsOfUnix) / 60)} minutes
              old — the upstream observability store was briefly unavailable.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
