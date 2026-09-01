'use client';

/**
 * React Query hooks for banks and their members (gibson#1706 lane E1).
 *
 * Reads go to /api/banks*, which resolves the active tenant server-side; the
 * client never passes a tenant. Mutations use `apiFetch` so the CSRF token
 * rides along. Members re-poll, so a state chip follows the heartbeat.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/src/lib/api/fetch';
import { queryKeys } from '@/src/lib/query/keys';
import { useTenantId } from '@/src/lib/auth/tenant';
import type { BankView, MemberView } from '@/src/lib/banks/view';
import type { CreateBankFormValues, UpdateBankFormValues } from '@/src/lib/banks/schema';

const MEMBERS_POLL_MS = 10_000;

interface ApiError {
  error?: { code?: string; message?: string };
}

async function readError(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as ApiError;
  return new Error(body.error?.message ?? `${fallback} (HTTP ${res.status})`);
}

async function fetchBanks(): Promise<BankView[]> {
  const res = await fetch('/api/banks');
  if (!res.ok) throw await readError(res, 'Failed to list banks');
  const body = (await res.json()) as { data?: BankView[] };
  return body.data ?? [];
}

async function fetchBank(id: string): Promise<BankView> {
  const res = await fetch(`/api/banks/${encodeURIComponent(id)}`);
  if (!res.ok) throw await readError(res, 'Failed to load bank');
  const body = (await res.json()) as { data: BankView };
  return body.data;
}

async function fetchMembers(id: string): Promise<MemberView[]> {
  const res = await fetch(`/api/banks/${encodeURIComponent(id)}/members`);
  if (!res.ok) throw await readError(res, 'Failed to list members');
  const body = (await res.json()) as { data?: MemberView[] };
  return body.data ?? [];
}

export function useBanks(): UseQueryResult<BankView[]> {
  const tenantId = useTenantId() ?? '';
  return useQuery({ queryKey: queryKeys.banks.list(tenantId), queryFn: fetchBanks });
}

export function useBank(id: string): UseQueryResult<BankView> {
  const tenantId = useTenantId() ?? '';
  return useQuery({ queryKey: queryKeys.banks.detail(tenantId, id), queryFn: () => fetchBank(id), enabled: id !== '' });
}

export function useBankMembers(id: string): UseQueryResult<MemberView[]> {
  const tenantId = useTenantId() ?? '';
  return useQuery({
    queryKey: queryKeys.banks.members(tenantId, id),
    queryFn: () => fetchMembers(id),
    enabled: id !== '',
    refetchInterval: MEMBERS_POLL_MS,
  });
}

export function useCreateBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateBankFormValues): Promise<BankView> => {
      const res = await apiFetch('/api/banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw await readError(res, 'Failed to create bank');
      const body = (await res.json()) as { data: BankView };
      return body.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.banks.all }),
  });
}

export function useUpdateBank(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: UpdateBankFormValues): Promise<BankView> => {
      const res = await apiFetch(`/api/banks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) throw await readError(res, 'Failed to update bank');
      const body = (await res.json()) as { data: BankView };
      return body.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.banks.all }),
  });
}

export function useDeleteBank() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const res = await apiFetch(`/api/banks/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw await readError(res, 'Failed to delete bank');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.banks.all }),
  });
}
