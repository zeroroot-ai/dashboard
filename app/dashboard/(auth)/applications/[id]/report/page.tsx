'use client';

/**
 * /dashboard/applications/[id]/report
 *
 * The per-Application report (dashboard#1157). Reads the two surfaces that
 * already exist, the tenant knowledge graph and the World's LLM-call log, and
 * folds them into one view for a single Application. It opens no new daemon
 * channel: every number on the page comes out of `/api/graph` and
 * `/api/traces` through the pure derivation in
 * `src/lib/application-report/report.ts`, which is where the fixture tests
 * live.
 *
 * `[id]` is the Application node's `key` property, the identity gibson's
 * Taxonomy v2 gives every lifecycle entity.
 */

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { useGraph } from '@/src/hooks/useGraph';
import { useTenantStore } from '@/src/stores/tenant-store';
import { ApplicationReportView } from '@/components/gibson/application-report/ApplicationReportView';
import { deriveApplicationReport } from '@/src/lib/application-report/report';
import type { LlmCallSummary } from '@/src/types/trace';

interface RunListShape {
  runs?: { calls?: LlmCallSummary[] }[];
}

/**
 * The World's LLM calls, flattened out of their runs. Cost is attributed per
 * call by scope, so the run grouping the traces page needs is not wanted here.
 */
async function fetchCalls(): Promise<LlmCallSummary[]> {
  const res = await fetch('/api/traces');
  if (!res.ok) {
    throw new Error(`Failed to load traces: ${res.status}`);
  }
  const body: RunListShape = await res.json();
  return (body.runs ?? []).flatMap((r) => r.calls ?? []);
}

export default function ApplicationReportPage() {
  const params = useParams<{ id: string }>();
  const applicationKey = decodeURIComponent(params?.id ?? '');
  const currentTenant = useTenantStore((state) => state.currentTenant);
  const tenantId = currentTenant?.id ?? '';

  const graphQuery = useGraph(null);
  const tracesQuery = useQuery({
    queryKey: ['traces', tenantId, 'calls'],
    queryFn: fetchCalls,
    staleTime: 60 * 1000,
  });

  const report = useMemo(() => {
    const nodes = graphQuery.data?.nodes ?? [];
    const edges = graphQuery.data?.edges ?? [];
    // Traces are additive: a failure there costs the spend tile, not the page,
    // so the report is still derived with an empty call list.
    const calls = tracesQuery.data ?? [];
    return deriveApplicationReport({ nodes, edges, calls, applicationKey });
  }, [graphQuery.data, tracesQuery.data, applicationKey]);

  if (graphQuery.isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (graphQuery.isError) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>The graph could not be read</AlertTitle>
          <AlertDescription>
            This report is a fold of the knowledge graph, so it cannot be shown until the graph
            loads. Try again in a moment.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6">
      {tracesQuery.isError ? (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>Model spend is unavailable</AlertTitle>
          <AlertDescription>
            The trace log could not be read, so the spend tile reads zero. Every other number on
            this page comes from the graph and is unaffected.
          </AlertDescription>
        </Alert>
      ) : null}
      <ApplicationReportView report={report} />
    </div>
  );
}
