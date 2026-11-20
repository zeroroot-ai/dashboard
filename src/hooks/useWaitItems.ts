// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { readJson } from '@/src/lib/api/read-json';
import { useTenantId } from '@/src/lib/auth/tenant';
import { useDestructiveActions } from '@/src/hooks/useDestructiveActions';
import { waitItemsFromApi, type WaitItem, type WaitingItemDto } from '@/src/lib/waits/wait-items';

interface WaitItemsResult {
  items: WaitItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * The items that wait on a person: the four kinds of
 * WorldService.ListWaitingOnPerson. The queue of pending destructive actions
 * adds the blast radius and the reversibility to a destructive action. A
 * failure of that queue leaves those details unknown. It does not hide the item.
 */
export function useWaitItems(): WaitItemsResult {
  const tenantId = useTenantId() ?? '';
  const waiting = useQuery({
    queryKey: ['world', tenantId, 'waiting'],
    queryFn: () =>
      readJson<{ items: WaitingItemDto[] }>('/api/world/waiting', 'Failed to load the items that wait on a person'),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const destructive = useDestructiveActions();
  const items = React.useMemo(
    () => waitItemsFromApi(waiting.data?.items ?? [], destructive.data?.items ?? []),
    [waiting.data, destructive.data],
  );
  return {
    items,
    isLoading: waiting.isLoading,
    error: waiting.error,
    refetch: () => void waiting.refetch(),
  };
}
