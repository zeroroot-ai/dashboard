"use client";

/**
 * SecretsAccessedPanel, per-mission resolved-secret refs panel.
 *
 * Renders one row per secret ref accessed during a mission's lifetime,
 * aggregated by the daemon's audit pipeline via the GetMissionAudit admin RPC.
 *
 * Each row shows:
 *   - Ref name (e.g. "cred:db_password" or "provider_config:anthropic:default")
 *   - Category (CRED / PROVIDER_CONFIG)
 *   - First access timestamp
 *   - Last access timestamp
 *   - Access count
 *   - Plugin install IDs that resolved the ref
 *
 * Each ref links to /dashboard/pages/settings/secrets/<encoded-ref>.
 *
 * SECURITY: Refs only, credential values are NEVER shown, fetched, or logged.
 *
 * Aggregation lag: if the daemon reports aggregation_lag_seconds > 5 the panel
 * shows a placeholder. It auto-refreshes every 5 seconds until lag clears.
 *
 * Mount: added as a new "Secrets" tab on the existing mission detail page at
 * app/dashboard/(auth)/missions/[id]/page.tsx.
 *
 * Spec: secrets-tenant-lifecycle Task 17, Requirement 6.
 */

import * as React from "react";
import Link from "next/link";
import { ClockIcon, KeyRoundIcon, RefreshCwIcon } from "lucide-react";
import { cn } from "@/lib/utils";

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
import { Skeleton } from "@/components/ui/skeleton";

import { fetchMissionAudit } from "@/src/components/missions/secrets-panel-action";
import type { MissionSecretAccess, SecretCategory } from "@/src/lib/gibson-client/secrets";
import { SecretCategory as SC } from "@/src/gen/gibson/tenant/v1/secrets_pb";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LAG_THRESHOLD_SECONDS = 5;
const AUTO_REFRESH_MS = 5_000;

function formatUnixTs(unixSec: bigint): string {
  if (unixSec === BigInt(0)) return "-";
  return new Date(Number(unixSec) * 1000).toLocaleString();
}

function categoryLabel(cat: SecretCategory): string {
  switch (cat) {
    case SC.CRED:
      return "cred";
    case SC.PROVIDER_CONFIG:
      return "provider_config";
    default:
      return "unknown";
  }
}

/**
 * Build the link to the secret detail page from the ref.
 *
 * The secret detail page uses the name as the path segment, URL-encoded.
 * /dashboard/pages/settings/secrets/<encoded-ref>
 */
function secretDetailHref(ref: string): string {
  return `/dashboard/pages/settings/secrets/${encodeURIComponent(ref)}`;
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PanelSkeleton() {
  return (
    <div className="space-y-2 py-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full rounded" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lag placeholder
// ---------------------------------------------------------------------------

function LagPlaceholder({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <ClockIcon className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-medium">Aggregation in progress</p>
        <p className="text-xs text-muted-foreground">
          The audit pipeline is catching up. This usually takes a few seconds.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onRefresh}
        className="gap-1.5"
      >
        <RefreshCwIcon className="size-3.5" aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <KeyRoundIcon className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">
        No secrets were resolved during this mission.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Access row
// ---------------------------------------------------------------------------

function AccessRow({ access }: { access: MissionSecretAccess }) {
  return (
    <TableRow>
      {/* Ref, links to secret detail */}
      <TableCell className="font-mono text-xs">
        <Link
          href={secretDetailHref(access.ref)}
          className="text-primary underline-offset-2 hover:underline"
        >
          {access.ref}
        </Link>
        <Badge
          variant="outline"
          className="ml-2 text-[10px] px-1 py-0 h-4 font-mono"
        >
          {categoryLabel(access.category)}
        </Badge>
      </TableCell>

      {/* First access */}
      <TableCell className="text-xs font-mono tabular-nums text-muted-foreground">
        {formatUnixTs(access.firstAccessAtUnix)}
      </TableCell>

      {/* Last access */}
      <TableCell className="text-xs font-mono tabular-nums text-muted-foreground">
        {formatUnixTs(access.lastAccessAtUnix)}
      </TableCell>

      {/* Count */}
      <TableCell className="text-xs tabular-nums font-medium text-center">
        {access.count}
      </TableCell>

      {/* Plugin install IDs */}
      <TableCell>
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {access.pluginInstallIds.length === 0 ? (
            <span className="text-xs text-muted-foreground">-</span>
          ) : (
            access.pluginInstallIds.slice(0, 2).map((id) => (
              <Badge
                key={id}
                variant="secondary"
                className="font-mono text-[10px] px-1 py-0 h-4 truncate max-w-[90px]"
                title={id}
              >
                {id}
              </Badge>
            ))
          )}
          {access.pluginInstallIds.length > 2 && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1 py-0 h-4 text-muted-foreground"
              title={access.pluginInstallIds.slice(2).join(", ")}
            >
              +{access.pluginInstallIds.length - 2}
            </Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface SecretsAccessedPanelProps {
  missionId: string;
}

export function SecretsAccessedPanel({ missionId }: SecretsAccessedPanelProps) {
  const [accesses, setAccesses] = React.useState<MissionSecretAccess[] | null>(null);
  const [lag, setLag] = React.useState(0);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);

  const isLoading = accesses === null && loadError === null;
  const isLagging = lag > LAG_THRESHOLD_SECONDS;

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await fetchMissionAudit(missionId);
      setAccesses(result.accesses ?? []);
      setLag(result.aggregationLagSeconds ?? 0);
      setLoadError(null);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load secrets audit."
      );
    } finally {
      setRefreshing(false);
    }
  }, [missionId]);

  // Initial load
  React.useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while lagging
  React.useEffect(() => {
    if (!isLagging) return;
    const timer = setTimeout(() => {
      void load();
    }, AUTO_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [isLagging, load]);

  // ---- Render ----

  if (loadError) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      >
        <p className="font-medium">Failed to load secrets audit</p>
        <p className="mt-1 text-xs opacity-80">{loadError}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load()}
          className="mt-2 gap-1.5 text-xs"
        >
          <RefreshCwIcon className="size-3" aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <PanelSkeleton />;
  }

  if (isLagging) {
    return <LagPlaceholder onRefresh={() => void load()} />;
  }

  if (!accesses || accesses.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {accesses.length} secret ref{accesses.length !== 1 ? "s" : ""} resolved during this mission.
          Refs only, values are never shown.
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          disabled={refreshing}
          className={cn("gap-1.5 h-7 text-xs", refreshing && "opacity-60")}
          aria-label="Refresh secrets audit"
        >
          <RefreshCwIcon
            className={cn("size-3", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          {refreshing ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">Ref</TableHead>
            <TableHead className="text-xs">First access</TableHead>
            <TableHead className="text-xs">Last access</TableHead>
            <TableHead className="text-xs text-center">Count</TableHead>
            <TableHead className="text-xs">Resolved by</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accesses.map((access) => (
            <AccessRow key={access.ref} access={access} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
