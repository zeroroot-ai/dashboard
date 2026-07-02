"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpDown, ChevronDown, ChevronUp, ShieldAlertIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

type SortField = "severity" | "title" | "type" | "asset" | "discovered";
type SortDir = "asc" | "desc";

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

interface MissionFindingsTabProps {
  missionId: string;
}

/**
 * MissionFindingsTab renders the findings produced by a single mission.
 *
 * Data source: the global findings endpoint (/api/findings) with a
 * missionId filter, same Finding shape, same hook (useFindings), same
 * severity + sort affordances as the global findings page. The Mission
 * column is omitted (always the same mission) and the page-level search
 * / export / severity-filter chrome is left to the global page.
 */
export function MissionFindingsTab({ missionId }: MissionFindingsTabProps) {
  const [sortField, setSortField] = React.useState<SortField>("severity");
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");

  const { data, isLoading, isError, error, refetch } = useFindings(
    { missionId },
    { limit: 500 },
  );

  const findings: Finding[] = data?.data ?? [];

  function handleSort(field: SortField) {
    if (field === sortField) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

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
        case "discovered":
          cmp = getDiscoveredTs(b.discoveredAt) - getDiscoveredTs(a.discoveredAt);
          break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [findings, sortField, sortDir]);

  if (isLoading) {
    return <TableSkeleton rows={6} cols={5} />;
  }

  if (isError) {
    return (
      <ErrorAlert
        error={error instanceof Error ? error : { message: String(error) }}
        title="Failed to load findings"
        retry={() => refetch()}
      />
    );
  }

  if ((data?.total ?? 0) === 0) {
    return (
      <EmptyState
        icon={ShieldAlertIcon}
        title="No findings yet"
        description="Findings appear here as the mission's agents produce results. If the mission is still running, refresh shortly."
        primaryCta={
          <Button asChild variant="ghost">
            <Link href="/dashboard/findings">All findings</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
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
            {visibleFindings.map((finding) => (
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
                    {finding.affectedAssets.join(", ") || "-"}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatDiscoveredAt(finding.discoveredAt)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground px-1 text-xs">
        Showing{" "}
        <span className="text-highlight font-medium">{visibleFindings.length}</span> of{" "}
        <span className="text-highlight font-medium">{data?.total ?? 0}</span> findings
      </p>
    </div>
  );
}
