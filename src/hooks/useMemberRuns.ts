'use client';

/**
 * Which running agents are bank members (gibson#1706 lane E3).
 *
 * Polls /api/banks/members and indexes the members by `agentRunId`, so a
 * console tile can tell it shows a member, and of which bank. The daemon is
 * the source of both lists; the dashboard only joins them.
 */

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { MemberWithBankView } from '@/src/lib/banks/view';

const POLL_MS = 10_000;

async function fetchMembers(): Promise<MemberWithBankView[]> {
  const res = await fetch('/api/banks/members');
  if (!res.ok) throw new Error(`Failed to list bank members: ${res.statusText}`);
  const body = (await res.json()) as { data?: MemberWithBankView[] };
  return body.data ?? [];
}

export function useMemberRuns(): ReadonlyMap<string, MemberWithBankView> {
  const tenantId = useTenantId() ?? '';
  const { data } = useQuery({
    queryKey: ['banks', tenantId, 'members', 'all'],
    queryFn: fetchMembers,
    refetchInterval: POLL_MS,
  });
  return React.useMemo(() => {
    const map = new Map<string, MemberWithBankView>();
    for (const m of data ?? []) if (m.agentRunId) map.set(m.agentRunId, m);
    return map;
  }, [data]);
}
