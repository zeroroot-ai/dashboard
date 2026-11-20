// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

import * as React from 'react';
import { useDestructiveActions } from '@/src/hooks/useDestructiveActions';
import { waitItemsFromDestructiveActions, type WaitItem } from '@/src/lib/waits/wait-items';

interface WaitItemsResult {
  items: WaitItem[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * The items that wait on a person. Today the one source is the queue of
 * pending destructive actions. The three other kinds join here when the
 * tenant API of gibson#1500 exists.
 */
export function useWaitItems(): WaitItemsResult {
  const destructive = useDestructiveActions();
  const items = React.useMemo(
    () => waitItemsFromDestructiveActions(destructive.data?.items ?? []),
    [destructive.data],
  );
  return {
    items,
    isLoading: destructive.isLoading,
    error: destructive.error,
    refetch: () => void destructive.refetch(),
  };
}
