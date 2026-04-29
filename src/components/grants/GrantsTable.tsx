"use client";

/**
 * GrantsTable — Client component for the grants inspector page.
 *
 * Renders active capability grants with filterable columns:
 *   - JTI
 *   - Recipient install ID + class
 *   - Allowed RPCs
 *   - Expires at
 *
 * Near-expiry rows (within 5 minutes) are highlighted with an amber warning
 * class per Requirement 4.1.
 *
 * Filters: recipient class, RPC substring. Both are client-side against the
 * server-fetched data set (the server already applies any near-expiry-only
 * filter if requested).
 *
 * Read-only — no revoke surface per Requirement 4.2.
 *
 * Spec: secrets-tenant-lifecycle Task 16, Requirement 4.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { CapabilityGrantInfo, RecipientClass } from "@/src/lib/gibson-client/grants";
import { RecipientClass as RC } from "@/src/gen/gibson/admin/v1/grants_pb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RECIPIENT_CLASS_LABELS: Record<number, string> = {
  [RC.UNSPECIFIED]: "All",
  [RC.AGENT]: "Agent",
  [RC.TOOL]: "Tool",
  [RC.PLUGIN]: "Plugin",
};

function formatUnixTs(unixSec: bigint): string {
  if (unixSec === BigInt(0)) return "—";
  return new Date(Number(unixSec) * 1000).toLocaleString();
}

function recipientClassLabel(rc: RecipientClass): string {
  return RECIPIENT_CLASS_LABELS[rc as number] ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface GrantsTableProps {
  grants: CapabilityGrantInfo[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GrantsTable({ grants }: GrantsTableProps) {
  const [classFilter, setClassFilter] = React.useState<string>("0");
  const [rpcFilter, setRpcFilter] = React.useState<string>("");

  const filtered = React.useMemo(() => {
    return grants.filter((g) => {
      const classMatch =
        classFilter === "0" ||
        String(g.recipientClass as number) === classFilter;

      const rpcLower = rpcFilter.trim().toLowerCase();
      const rpcMatch =
        rpcLower === "" ||
        g.allowedRpcs.some((r) => r.toLowerCase().includes(rpcLower));

      return classMatch && rpcMatch;
    });
  }, [grants, classFilter, rpcFilter]);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="class-filter" className="text-xs text-muted-foreground">
            Recipient class
          </Label>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger id="class-filter" size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">All</SelectItem>
              <SelectItem value={String(RC.AGENT)}>Agent</SelectItem>
              <SelectItem value={String(RC.TOOL)}>Tool</SelectItem>
              <SelectItem value={String(RC.PLUGIN)}>Plugin</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rpc-filter" className="text-xs text-muted-foreground">
            RPC
          </Label>
          <Input
            id="rpc-filter"
            placeholder="Filter by RPC name..."
            value={rpcFilter}
            onChange={(e) => setRpcFilter(e.target.value)}
            className="h-8 w-56 text-sm"
          />
        </div>

        <p className="text-xs text-muted-foreground pb-1.5">
          {filtered.length} of {grants.length} grant{grants.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No active grants match the current filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-mono text-xs">JTI</TableHead>
              <TableHead className="text-xs">Recipient</TableHead>
              <TableHead className="text-xs">Allowed RPCs</TableHead>
              <TableHead className="text-xs">Expires at</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((grant) => (
              <TableRow
                key={grant.jti}
                className={cn(
                  grant.nearExpiry &&
                    "bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/20"
                )}
              >
                {/* JTI */}
                <TableCell className="font-mono text-xs max-w-[200px] truncate" title={grant.jti}>
                  {grant.jti}
                  {grant.nearExpiry && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-amber-500/50 text-amber-600 dark:text-amber-400 text-[10px] px-1 py-0 h-4"
                    >
                      expiring soon
                    </Badge>
                  )}
                </TableCell>

                {/* Recipient */}
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="text-xs font-medium font-mono truncate max-w-[160px]" title={grant.recipientInstallId}>
                      {grant.recipientInstallId || "—"}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                        {recipientClassLabel(grant.recipientClass)}
                      </Badge>
                      {grant.recipientName && (
                        <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                          {grant.recipientName}
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>

                {/* Allowed RPCs */}
                <TableCell>
                  <div className="flex flex-wrap gap-1 max-w-[240px]">
                    {grant.allowedRpcs.length === 0 ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      grant.allowedRpcs.slice(0, 3).map((rpc) => (
                        <Badge
                          key={rpc}
                          variant="secondary"
                          className="font-mono text-[10px] px-1 py-0 h-4"
                        >
                          {rpc}
                        </Badge>
                      ))
                    )}
                    {grant.allowedRpcs.length > 3 && (
                      <Badge
                        variant="secondary"
                        className="font-mono text-[10px] px-1 py-0 h-4 text-muted-foreground"
                        title={grant.allowedRpcs.slice(3).join(", ")}
                      >
                        +{grant.allowedRpcs.length - 3} more
                      </Badge>
                    )}
                  </div>
                </TableCell>

                {/* Expires at */}
                <TableCell
                  className={cn(
                    "text-xs font-mono tabular-nums",
                    grant.nearExpiry && "text-amber-600 dark:text-amber-400 font-medium"
                  )}
                >
                  {formatUnixTs(grant.expiresAtUnix)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
