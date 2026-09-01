'use client';

/**
 * React Query hooks for jobs (gibson#1706 lane E3). Reads go to /api/jobs*,
 * mutations through `apiFetch` (CSRF). A job list re-polls so state chips
 * follow the member.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/fetch';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { JobEventView, JobView } from '@/src/lib/jobs/view';
import type { CloseJobValues, OpenJobValues, SendInputValues } from '@/src/lib/jobs/schema';

const JOBS_POLL_MS = 10_000;

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as ApiError;
  return new Error(body.error?.message ?? `${fallback} (HTTP ${res.status})`);
}

interface JobsFilter {
  bankId?: string;
  memberId?: string;
  state?: 'open' | 'working' | 'waiting' | 'closed';
}

async function fetchJobs(f: JobsFilter): Promise<JobView[]> {
  const q = new URLSearchParams();
  if (f.bankId) q.set('bankId', f.bankId);
  if (f.memberId) q.set('memberId', f.memberId);
  if (f.state) q.set('state', f.state);
  const res = await fetch(`/api/jobs${q.size > 0 ? `?${q.toString()}` : ''}`);
  if (!res.ok) throw await readError(res, 'Failed to list jobs');
  const body = (await res.json()) as { data?: JobView[] };
  return body.data ?? [];
}

export function useJobs(filter: JobsFilter, enabled = true): UseQueryResult<JobView[]> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: ['jobs', tenantId, 'list', filter.bankId ?? '', filter.memberId ?? '', filter.state ?? ''],
    queryFn: () => fetchJobs(filter),
    enabled,
    refetchInterval: JOBS_POLL_MS,
  });
}

export function useOpenJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: OpenJobValues): Promise<JobView> => {
      const res = await apiFetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw await readError(res, 'Failed to open job');
      const body = (await res.json()) as { data: JobView };
      return body.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useSendInput(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: SendInputValues): Promise<void> => {
      const res = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw await readError(res, 'Failed to send input');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useCloseJob(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CloseJobValues): Promise<JobView> => {
      const res = await apiFetch(`/api/jobs/${encodeURIComponent(jobId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw await readError(res, 'Failed to close job');
      const body = (await res.json()) as { data: JobView };
      return body.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

/** Where a job event feed stands. */
type JobFeedPhase = 'streaming' | 'closed' | 'gone' | 'error';

interface JobFeed {
  events: JobEventView[];
  phase: JobFeedPhase;
}

/** The subset of EventSource the feed uses. Tests pass a fake. */
interface JobEventSourceLike {
  addEventListener: (name: string, fn: (e: MessageEvent<string>) => void) => void;
  close: () => void;
}

/** Bounded event log per job kept in memory. */
const EVENT_CAP = 500;

/**
 * Follows one job's events over SSE (/api/jobs/:id/events) and keeps them in
 * order. A reconnect resumes after the last seq seen. Nothing is written to
 * browser storage.
 */
export function useJobEvents(
  jobId: string | null,
  open: (url: string) => JobEventSourceLike = (url) => new EventSource(url),
): JobFeed {
  const [feed, setFeed] = React.useState<JobFeed>({ events: [], phase: 'streaming' });
  React.useEffect(() => {
    if (!jobId) return;
    setFeed({ events: [], phase: 'streaming' });
    let lastSeq = BigInt(0);
    const es = open(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    es.addEventListener('job', (e) => {
      let ev: JobEventView;
      try {
        ev = JSON.parse(e.data) as JobEventView;
      } catch {
        return;
      }
      if (/^\d+$/.test(ev.seq)) {
        const seq = BigInt(ev.seq);
        if (seq <= lastSeq) return;
        lastSeq = seq;
      }
      setFeed((prev) => {
        const events = [...prev.events, ev];
        if (events.length > EVENT_CAP) events.splice(0, events.length - EVENT_CAP);
        return { ...prev, events };
      });
    });
    es.addEventListener('end', () => setFeed((prev) => ({ ...prev, phase: 'closed' })));
    es.addEventListener('notfound', () => setFeed((prev) => ({ ...prev, phase: 'gone' })));
    es.addEventListener('error', (e) => {
      if (typeof e.data !== 'string' || e.data.length === 0) return;
      setFeed((prev) => ({ ...prev, phase: 'error' }));
    });
    return () => es.close();
  }, [jobId, open]);
  return feed;
}
