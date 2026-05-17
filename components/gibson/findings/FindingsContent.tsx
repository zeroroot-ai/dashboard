"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronDown, ChevronUp, Download, Search, ShieldAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton, ErrorAlert } from "@/components/gibson/shared";
import { EmptyState } from "@/components/gibson/shared/EmptyState";
import { useFindings } from "@/src/hooks/useFindings";
import type { Finding, FindingSeverity } from "@/src/types";
import { FindingsExportDialog } from "./FindingsExportDialog";

// ── Types ────────────────────────────────────────────────────────────────────

type SortField = "severity" | "title" | "type" | "asset" | "mission" | "discovered";
type SortDir = "asc" | "desc";

// ── Severity helpers ─────────────────────────────────────────────────────────

const ALL_SEVERITIES: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

const SEVERITY_BADGE_CLASS: Record<FindingSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10/60 text-destructive",
  high: "border-alt/40 bg-alt/10/60 text-alt",
  medium: "border-alt/40 bg-alt/10/60 text-alt",
  low: "border-highlight/40 bg-highlight/10/60 text-highlight",
  info: "border-border bg-muted/60 text-muted-foreground",
};

const SEVERITY_LABELS: Record<FindingSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

// ── Sub-components ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  return (
    <Badge
      className={`border font-mono text-xs uppercase tracking-wide ${SEVERITY_BADGE_CLASS[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </Badge>
  );
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
}) {
  if (field !== sortField) {
    return <ArrowUpDown className="ml-1 inline size-3 opacity-40" />;
  }
  return sortDir === "asc" ? (
    <ChevronUp className="ml-1 inline size-3 text-highlight" />
  ) : (
    <ChevronDown className="ml-1 inline size-3 text-highlight" />
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDiscoveredAt(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getDiscoveredTs(date: Date | string): number {
  return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

// ── Main component ───────────────────────────────────────────────────────────

export function FindingsContent() {
  // Filter state — severity checkboxes
  const [enabledSeverities, setEnabledSeverities] = React.useState<Set<FindingSeverity>>(
    new Set(ALL_SEVERITIES),
  );
  const [rawSearch, setRawSearch] = React.useState("");
  const [search, setSearch] = React.useState("");
  const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sort state
  const [sortField, setSortField] = React.useState<SortField>("severity");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  // Export dialog
  const [exportOpen, setExportOpen] = React.useState(false);

  // Build severity filter array for the hook — pass only checked severities
  const severityFilter = React.useMemo(
    () => ALL_SEVERITIES.filter((s) => enabledSeverities.has(s)),
    [enabledSeverities],
  );

  // Fetch findings — severity filter is sent as query params; search is client-side
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useFindings(
    {
      severity: severityFilter.length < ALL_SEVERITIES.length ? severityFilter : undefined,
      search: search || undefined,
    },
    { limit: 200 },
  );

  const findings: Finding[] = data?.data ?? [];

  // Debounce search
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setRawSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearch(value), 300);
  }

  React.useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  // Toggle a severity checkbox
  function toggleSeverity(severity: FindingSeverity) {
    setEnabledSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  }

  // Handle sort column click
  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  // Client-side sort of the API results
  const visibleFindings = React.useMemo(() => {
    return [...findings].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "severity":
          cmp = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
          break;
        case "title":
          cmp = a.title.localeCompare(b.title);
          break;
        case "type":
          cmp = a.type.localeCompare(b.type);
          break;
        case "asset":
          cmp = (a.affectedAssets[0] ?? "").localeCompare(b.affectedAssets[0] ?? "");
          break;
        case "mission":
          cmp = a.missionId.localeCompare(b.missionId);
          break;
        case "discovered":
          cmp = getDiscoveredTs(b.discoveredAt) - getDiscoveredTs(a.discoveredAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [findings, sortField, sortDir]);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-glow-green lg:text-2xl">
          Findings
        </h1>
        <Button variant="outline" size="sm" onClick={() => setExportOpen(true)}>
          <Download />
          Export
        </Button>
      </div>

      {/* ── Filter bar ── */}
      <div className="glass-hack rounded-lg p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Severity checkboxes */}
          <div className="flex flex-wrap items-center gap-4">
            {ALL_SEVERITIES.map((sev) => (
              <div key={sev} className="flex items-center gap-1.5">
                <Checkbox
                  id={`sev-${sev}`}
                  checked={enabledSeverities.has(sev)}
                  onCheckedChange={() => toggleSeverity(sev)}
                  className={
                    enabledSeverities.has(sev)
                      ? sev === "critical"
                        ? "data-[state=checked]:bg-destructive data-[state=checked]:border-destructive/40"
                        : sev === "high"
                        ? "data-[state=checked]:bg-alt data-[state=checked]:border-alt/40"
                        : sev === "medium"
                        ? "data-[state=checked]:bg-alt data-[state=checked]:border-alt/40"
                        : sev === "low"
                        ? "data-[state=checked]:bg-highlight data-[state=checked]:border-highlight/40"
                        : "data-[state=checked]:bg-muted data-[state=checked]:border-border"
                      : ""
                  }
                />
                <Label
                  htmlFor={`sev-${sev}`}
                  className="cursor-pointer text-xs font-medium capitalize"
                >
                  {SEVERITY_LABELS[sev]}
                </Label>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-64">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <Input
              placeholder="Search findings..."
              value={rawSearch}
              onChange={handleSearchChange}
              className="pl-8 text-sm"
            />
          </div>
        </div>
      </div>

      {/* ── Error state ── */}
      {isError && (
        <ErrorAlert
          error={error instanceof Error ? error : { message: String(error) }}
          title="Failed to load findings"
          retry={() => refetch()}
        />
      )}

      {/* ── Loading state ── */}
      {isLoading && <TableSkeleton rows={8} cols={6} />}

      {/* ── Empty state — no findings at all (dataset empty, not just filtered) ── */}
      {!isLoading && !isError && (data?.total ?? 0) === 0 && (
        <EmptyState
          icon={ShieldAlertIcon}
          title="No findings yet"
          description="Findings are created as missions run agents against your targets. Once a mission produces a result, it will land here for triage and export."
          primaryCta={
            <Button asChild>
              <Link href="/dashboard/missions/create">Create a mission</Link>
            </Button>
          }
          secondaryCta={
            <Button asChild variant="ghost">
              <Link href="/docs/missions">Read the docs</Link>
            </Button>
          }
        />
      )}

      {/* ── Table ── */}
      {!isLoading && !isError && (data?.total ?? 0) > 0 && (
        <div className="glass-hack rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-highlight/30 hover:bg-transparent">
                {(
                  [
                    { field: "severity" as SortField, label: "Severity" },
                    { field: "title" as SortField, label: "Title" },
                    { field: "type" as SortField, label: "Type" },
                    { field: "asset" as SortField, label: "Affected Asset" },
                    { field: "mission" as SortField, label: "Mission" },
                    { field: "discovered" as SortField, label: "Discovered" },
                  ] as { field: SortField; label: string }[]
                ).map(({ field, label }) => (
                  <TableHead
                    key={field}
                    className="text-muted-foreground cursor-pointer select-none text-xs uppercase tracking-wider hover:text-highlight transition-colors"
                    onClick={() => handleSort(field)}
                  >
                    {label}
                    <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleFindings.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    No findings match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                visibleFindings.map((finding) => (
                  <TableRow
                    key={finding.id}
                    className="border-b border-highlight/20 hover:bg-highlight/10/20 transition-colors"
                  >
                    <TableCell>
                      <SeverityBadge severity={finding.severity} />
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <span className="text-foreground text-sm font-medium leading-snug">
                        {finding.title}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-xs capitalize">
                        {finding.type}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="data-value text-xs">
                        {finding.affectedAssets.join(", ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-xs">{finding.missionId}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatDiscoveredAt(finding.discoveredAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Results count */}
      {!isLoading && !isError && (data?.total ?? 0) > 0 && (
        <p className="text-muted-foreground px-1 text-xs">
          Showing{" "}
          <span className="text-highlight font-medium">{visibleFindings.length}</span> of{" "}
          <span className="text-highlight font-medium">{data?.total ?? 0}</span> findings
        </p>
      )}

      {/* Export dialog */}
      <FindingsExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        findings={visibleFindings}
      />
    </div>
  );
}
