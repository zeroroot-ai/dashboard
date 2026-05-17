'use client';

/**
 * DataPlaneProgressPanel — client component that polls
 * GET /api/onboarding/data-plane every 2 seconds while any store is in
 * `provisioning` state and renders per-store status with friendly text.
 *
 * Stops polling when all three stores are `ready` (then triggers the
 * supplied `onAllReady` callback) or when any store hits `failed`.
 *
 * Design D8 — Task 34.
 */

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DataPlaneStatus, StoreStatus } from '@/src/types/onboarding';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataPlaneProgressPanelProps {
  /** Called once when all three stores reach `ready`. */
  onAllReady?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when every store is no longer in an active provisioning state. */
function allSettled(status: DataPlaneStatus): boolean {
  const stores = [status.postgres, status.redis, status.graph];
  return stores.every((s) => s.state === 'ready' || s.state === 'failed');
}

/** True when every store is `ready`. */
function allReady(status: DataPlaneStatus): boolean {
  const stores = [status.postgres, status.redis, status.graph];
  return stores.every((s) => s.state === 'ready');
}

/** True when at least one store is `failed`. */
function anyFailed(status: DataPlaneStatus): boolean {
  return [status.postgres, status.redis, status.graph].some(
    (s) => s.state === 'failed',
  );
}

// ---------------------------------------------------------------------------
// Per-store row component
// ---------------------------------------------------------------------------

interface StoreRowProps {
  label: string;
  hint?: string;
  status: StoreStatus;
}

function StoreRow({ label, hint, status }: StoreRowProps) {
  const { state, reason } = status;

  let indicator: React.ReactNode;

  if (state === 'ready') {
    indicator = <span className="text-highlight font-medium">&#10003;</span>;
  } else if (state === 'failed') {
    indicator = <span className="text-destructive font-medium">&#10007;</span>;
  } else if (state === 'provisioning') {
    indicator = (
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground" />
    );
  } else {
    // null — not started / legacy CRD
    indicator = (
      <span className="text-muted-foreground text-sm">pending</span>
    );
  }

  return (
    <li className="flex items-center gap-3 py-1">
      <span className="w-5 flex items-center justify-center">{indicator}</span>
      <span className="text-sm">
        {label}
        {state === 'provisioning' && hint ? (
          <span className="text-muted-foreground ml-1">{hint}</span>
        ) : null}
        {state === 'failed' && reason ? (
          <span className="text-destructive ml-1 text-xs">— {reason}</span>
        ) : null}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function DataPlaneProgressPanel({ onAllReady }: DataPlaneProgressPanelProps) {
  const { data, error, isLoading } = useQuery<DataPlaneStatus>({
    queryKey: ['onboarding', 'data-plane'],
    queryFn: async () => {
      const res = await fetch('/api/onboarding/data-plane');
      if (!res.ok) {
        throw new Error(`data-plane status: HTTP ${res.status}`);
      }
      return res.json() as Promise<DataPlaneStatus>;
    },
    // Poll every 2 s while any store is still provisioning.
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return 2_000;
      return allSettled(d) ? false : 2_000;
    },
    staleTime: 0,
    retry: 2,
  });

  // Notify the parent once all stores reach ready.
  useEffect(() => {
    if (data && allReady(data) && onAllReady) {
      onAllReady();
    }
  }, [data, onAllReady]);

  if (isLoading) {
    return (
      <p className="text-sm text-muted-foreground animate-pulse">
        Checking provisioning status…
      </p>
    );
  }

  if (error || !data) {
    return (
      <p className="text-sm text-destructive">
        Unable to read provisioning status. Please refresh or{' '}
        <a
          href="mailto:support@zero-day.ai"
          className="underline"
        >
          contact support
        </a>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1">
        <StoreRow label="Database" status={data.postgres} />
        <StoreRow label="Cache" status={data.redis} />
        <StoreRow
          label="Knowledge graph"
          hint="(~60s)…"
          status={data.graph}
        />
      </ul>

      {anyFailed(data) && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive space-y-2">
          <p>One or more stores failed to provision. Please contact support.</p>
          <p className="font-medium">
            <a
              href="mailto:support@zero-day.ai"
              className="underline"
            >
              support@zero-day.ai
            </a>
          </p>
        </div>
      )}

      {allReady(data) && (
        <p className="text-sm text-highlight font-medium">
          All systems ready — redirecting…
        </p>
      )}
    </div>
  );
}
